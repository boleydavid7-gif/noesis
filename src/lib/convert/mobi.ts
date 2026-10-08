// Kindle files (.mobi, .azw, .azw3, .prc) that have no copy protection.

import { pictureName } from './build'
import { mergeTiny, plainText, splitChapters, tidyHtml } from './html'
import type { Draft, Picture } from './types'

export class KindleProtectedError extends Error {
  constructor() {
    super('This Kindle book is copy-protected, so Noesis cannot open it. Books with no copy protection work.')
  }
}

// PalmDoc compression, the scheme Kindle files use for their text.
export function palmDecompress(input: Uint8Array): Uint8Array {
  const out: number[] = []
  let index = 0
  while (index < input.length) {
    const byte = input[index++]
    if (byte === 0 || (byte >= 9 && byte <= 0x7f)) out.push(byte)
    else if (byte >= 1 && byte <= 8) {
      for (let count = 0; count < byte && index < input.length; count += 1) out.push(input[index++])
    } else if (byte >= 0xc0) {
      out.push(0x20, byte ^ 0x80)
    } else {
      const pair = ((byte << 8) | (input[index++] ?? 0)) & 0x3fff
      const distance = pair >> 3
      const length = (pair & 7) + 3
      for (let step = 0; step < length; step += 1) out.push(out[out.length - distance] ?? 0)
    }
  }
  return Uint8Array.from(out)
}

const u16 = (view: DataView, at: number) => view.getUint16(at)
const u32 = (view: DataView, at: number) => view.getUint32(at)

// How many bytes at the end of a text record are extra data, not text.
function trailingSize(record: Uint8Array, flags: number): number {
  let total = 0
  for (let bit = 1; bit < 16; bit += 1) {
    if (!(flags & (1 << bit))) continue
    let size = 0
    let shift = 0
    let position = record.length - total
    for (;;) {
      const byte = record[position - 1]
      size |= (byte & 0x7f) << shift
      shift += 7
      position -= 1
      if (byte & 0x80 || shift >= 28 || position === 0) break
    }
    total += size
  }
  if (flags & 1) total += (record[record.length - total - 1] & 3) + 1
  return total
}

const BASE32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
const fromBase32 = (value: string) => [...value].reduce((sum, char) => sum * 32 + Math.max(0, BASE32.indexOf(char)), 0)

function pictureType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  return null
}

export function mobiToDraft(data: ArrayBuffer, filename: string): Draft {
  const bytes = new Uint8Array(data)
  const view = new DataView(data)
  if (bytes.length < 100) throw new Error('This does not look like a Kindle book.')
  const count = u16(view, 76)
  const offsets = Array.from({ length: count }, (_, index) => u32(view, 78 + index * 8))
  const record = (index: number) => bytes.subarray(offsets[index], offsets[index + 1] ?? bytes.length)

  const zero = record(0)
  const head = new DataView(zero.buffer, zero.byteOffset, zero.byteLength)
  const compression = u16(head, 0)
  const textRecords = u16(head, 8)
  const encryption = u16(head, 12)
  if (encryption !== 0) throw new KindleProtectedError()
  if (compression !== 1 && compression !== 2) throw new Error('This Kindle file uses a format Noesis cannot read yet.')
  const mobiLength = zero.length > 24 ? u32(head, 20) : 0
  const utf8 = zero.length > 32 && u32(head, 28) === 65001
  const firstPicture = zero.length > 112 ? u32(head, 108) : 0xffffffff
  const flags = mobiLength >= 228 && zero.length > 244 ? u16(head, 242) : 0

  const pieces: Uint8Array[] = []
  for (let index = 1; index <= textRecords && index < count; index += 1) {
    const raw = record(index)
    const body = raw.subarray(0, Math.max(0, raw.length - trailingSize(raw, flags)))
    pieces.push(compression === 2 ? palmDecompress(body) : body)
  }
  const joined = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
  let cursor = 0
  for (const piece of pieces) {
    joined.set(piece, cursor)
    cursor += piece.length
  }
  let markup = new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(joined)

  // Title and author live in the extra header (EXTH) after the main header.
  let title = ''
  let author = ''
  const nameOffset = zero.length > 92 ? u32(head, 84) : 0
  const nameLength = zero.length > 92 ? u32(head, 88) : 0
  if (nameOffset && nameLength && nameOffset + nameLength <= zero.length) {
    title = new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(zero.subarray(nameOffset, nameOffset + nameLength))
  }
  let coverIndex = -1
  const exth = 16 + mobiLength
  if (zero.length > 132 && u32(head, 128) & 0x40 && String.fromCharCode(...zero.subarray(exth, exth + 4)) === 'EXTH') {
    const entries = u32(head, exth + 8)
    let at = exth + 12
    for (let entry = 0; entry < entries && at + 8 <= zero.length; entry += 1) {
      const type = u32(head, at)
      const length = u32(head, at + 4)
      const value = zero.subarray(at + 8, at + length)
      const text = () => new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(value)
      if (type === 100 && !author) author = text()
      else if (type === 503) title = text()
      else if (type === 201 && value.length === 4)
        coverIndex = new DataView(value.buffer, value.byteOffset, 4).getUint32(0)
      at += Math.max(8, length)
    }
  }

  // Pictures follow the text records.
  const pictures: Picture[] = []
  const byRecord = new Map<number, string>()
  if (firstPicture !== 0xffffffff) {
    for (let index = firstPicture; index < count; index += 1) {
      const type = pictureType(record(index))
      if (!type) continue
      const name = pictureName(pictures.length + 1, type)
      pictures.push({ name, type, data: record(index).slice() })
      byRecord.set(index - firstPicture, name)
    }
  }
  markup = markup
    .replace(/<img\b[^>]*?recindex="0*(\d+)"[^>]*>/gi, (_, number: string) => {
      const name = byRecord.get(Number(number) - 1)
      return name ? `<img src="images/${name}" alt=""/>` : ''
    })
    .replace(/<img\b[^>]*?src="kindle:embed:([0-9A-V]+)[^"]*"[^>]*>/gi, (_, code: string) => {
      const name = byRecord.get(fromBase32(code) - 1)
      return name ? `<img src="images/${name}" alt=""/>` : ''
    })
    .replace(/<mbp:pagebreak\s*\/?>/gi, '\u0001')

  const sections = markup.split('\u0001').filter((section) => plainText(section).length > 0 || /<img/i.test(section))
  const chapters = mergeTiny(
    sections.flatMap((section, index) => {
      const html = tidyHtml(section, { images: true })
      return splitChapters(html, `Section ${index + 1}`)
    }),
    400,
  )
  if (chapters.length === 0) throw new Error('No readable text was found in this Kindle file.')
  const cover = coverIndex >= 0 ? byRecord.get(coverIndex) : pictures[0]?.name
  return {
    title: title.trim() || filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    author: author.trim() || 'Unknown author',
    chapters,
    pictures,
    cover,
  }
}
