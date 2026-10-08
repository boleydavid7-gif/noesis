// Brings books in other formats into the app by turning them into EPUB first, so every
// reading tool works the same way on all of them.

import JSZip from 'jszip'
import { buildEpub } from './build'
import { cbzToDraft } from './comics'
import { docxToDraft, fb2ToDraft, odtToDraft, rtfToDraft } from './documents'
import { mobiToDraft } from './mobi'
import { decodeText, htmlToDraft, markdownToDraft, textToDraft } from './simple'

const KINDS: Record<string, string[]> = {
  text: ['txt', 'text'],
  markdown: ['md', 'markdown'],
  html: ['html', 'htm', 'xhtml'],
  fb2: ['fb2', 'fbz'],
  docx: ['docx'],
  odt: ['odt'],
  rtf: ['rtf'],
  comic: ['cbz'],
  kindle: ['mobi', 'azw', 'azw3', 'prc'],
}

const extensionOf = (name: string) => name.toLowerCase().split('.').pop() ?? ''
const kindOf = (name: string) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.fb2.zip')) return 'fb2'
  const extension = extensionOf(lower)
  return Object.keys(KINDS).find((kind) => KINDS[kind].includes(extension))
}

export const CONVERTIBLE_EXTENSIONS = Object.values(KINDS).flat()
export const isConvertible = (name: string) => kindOf(name) !== undefined
export const IMPORT_ACCEPT = [
  '.epub',
  '.pdf',
  ...CONVERTIBLE_EXTENSIONS.map((extension) => `.${extension}`),
  '.fb2.zip',
].join(',')
export const isImportable = (name: string) => /\.(epub|pdf)$/i.test(name) || isConvertible(name)

export async function convertToEpub(file: File): Promise<ArrayBuffer> {
  const kind = kindOf(file.name)
  if (!kind) throw new Error('Noesis cannot read that kind of file.')
  const buffer = await file.arrayBuffer()
  const draft = await (async () => {
    switch (kind) {
      case 'text':
        return textToDraft(decodeText(new Uint8Array(buffer)), file.name)
      case 'markdown':
        return markdownToDraft(decodeText(new Uint8Array(buffer)), file.name)
      case 'html':
        return htmlToDraft(decodeText(new Uint8Array(buffer)), file.name)
      case 'fb2': {
        if (/\.(zip|fbz)$/i.test(file.name)) {
          const zip = await JSZip.loadAsync(buffer)
          const entry = Object.values(zip.files).find((item) => /\.fb2$/i.test(item.name))
          if (!entry) throw new Error('No FictionBook file was found inside.')
          return fb2ToDraft(decodeText(await entry.async('uint8array')), file.name)
        }
        return fb2ToDraft(decodeText(new Uint8Array(buffer)), file.name)
      }
      case 'docx':
        return docxToDraft(buffer, file.name)
      case 'odt':
        return odtToDraft(buffer, file.name)
      case 'rtf':
        return rtfToDraft(decodeText(new Uint8Array(buffer)), file.name)
      case 'comic':
        return cbzToDraft(buffer, file.name)
      default:
        return mobiToDraft(buffer, file.name)
    }
  })()
  const bytes = await buildEpub(draft)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
