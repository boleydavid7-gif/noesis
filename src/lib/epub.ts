import type { Book, NavItem } from 'epubjs'
import { shrinkCover } from './cover'
import type { LibraryBook } from './library'

function asText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

async function blobToDataUrl(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url)
    if (!response.ok) return undefined
    const blob = await response.blob()
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

function flattenNavigation(
  items: NavItem[],
  output: Array<{ label: string; href: string }> = [],
): Array<{ label: string; href: string }> {
  for (const item of items) {
    if (!item || typeof item.label !== 'string' || typeof item.href !== 'string') continue
    output.push({ label: item.label, href: item.href })
    if (Array.isArray(item.subitems)) flattenNavigation(item.subitems, output)
  }
  return output
}

function normalizeEpubData(file: ArrayBuffer): ArrayBuffer {
  const copy = file.slice(0)
  const bytes = new Uint8Array(copy.slice(0, 4))
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  if (!isZip)
    throw new Error('This is not a valid EPUB archive. Download the .epub file itself, not a web page or preview.')
  return copy
}

export class EpubProtectedError extends Error {
  constructor() {
    super(
      'This EPUB is copy-protected (DRM), so its pages are scrambled and Noesis cannot read it. ' +
        'Books with no copy protection work, such as Standard Ebooks or Project Gutenberg.',
    )
  }
}

// Font obfuscation is not copy protection; the text stays readable.
const FONT_ONLY = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']
const FONT_FILE = /\.(otf|ttf|woff2?|eot)$/i

/** Throws EpubProtectedError when the book's pages are encrypted rather than plain. */
export async function assertNotProtected(file: ArrayBuffer): Promise<void> {
  let xml: string | undefined
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(file.slice(0))
    xml = await zip.file('META-INF/encryption.xml')?.async('string')
  } catch {
    return
  }
  if (!xml) return
  for (const block of xml.match(/<(?:\w+:)?EncryptedData[\s\S]*?<\/(?:\w+:)?EncryptedData>/gi) ?? []) {
    const algorithm = /Algorithm=["']([^"']+)["']/i.exec(block)?.[1] ?? ''
    const uri = /<(?:\w+:)?CipherReference[^>]*URI=["']([^"']+)["']/i.exec(block)?.[1] ?? ''
    if (FONT_ONLY.includes(algorithm) || FONT_FILE.test(uri)) continue
    throw new EpubProtectedError()
  }
}

/** True when text is mostly binary noise (replacement marks and control characters), as in scrambled pages. */
export function looksScrambled(text: string): boolean {
  const sample = text.slice(0, 4000)
  if (sample.length < 40) return false
  let noise = 0
  for (const char of sample) {
    const code = char.charCodeAt(0)
    if (code === 0xfffd || (code < 32 && code !== 10 && code !== 13 && code !== 9) || (code >= 0x7f && code < 0xa0))
      noise += 1
  }
  return noise / sample.length > 0.03
}

export function spineSections(book: Book): Array<{ index: number; href?: string }> {
  const sections = (book.spine as unknown as { spineItems?: Array<{ index: number; href?: string }> }).spineItems
  return Array.isArray(sections) ? sections : []
}

export type ParsedEpub = {
  metadata: { title: string; author: string }
  coverDataUrl?: string
  toc: Array<{ label: string; href: string }>
  text: string
}

export async function parseEpub(file: ArrayBuffer, filename: string): Promise<ParsedEpub> {
  const { default: ePub } = await import('epubjs')
  const book = ePub()
  const input = normalizeEpubData(file)
  await assertNotProtected(input)
  await book.open(input, 'binary')
  const metadata = await book.loaded.metadata
  let navigation: NavItem[] = []
  try {
    const toc = (await book.loaded.navigation).toc
    navigation = Array.isArray(toc) ? toc : []
  } catch {
    // Some older EPUBs have malformed navigation documents but readable chapters.
  }
  let coverDataUrl: string | undefined
  try {
    const coverUrl = await book.coverUrl()
    coverDataUrl = coverUrl ? await shrinkCover(await blobToDataUrl(coverUrl)) : undefined
  } catch {
    // A missing or malformed cover should not prevent importing the book.
  }
  const textParts: string[] = []
  try {
    await book.loaded.spine
    // `loaded.spine` resolves to a Spine object (not an array, despite its
    // typings), so walk its section list directly.
    for (const item of spineSections(book).slice(0, 120)) {
      try {
        const section = book.spine.get(item.index)
        // section.load resolves with the document element, not the Document.
        const root = (await section.load(book.load.bind(book))) as unknown as Element
        const text = (root.querySelector('body') ?? root).textContent?.replace(/\s+/g, ' ').trim() ?? ''
        if (text) textParts.push(text)
        section.unload()
        if (textParts.join(' ').length >= 250_000) break
      } catch {
        // A malformed chapter should not prevent the book from importing.
      }
    }
  } catch {
    // Text indexing is an enhancement; the EPUB can still be read normally.
  }
  if (looksScrambled(textParts.join(' '))) throw new EpubProtectedError()
  const fallbackTitle =
    filename
      .replace(/\.epub$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim() || 'Untitled EPUB'
  return {
    metadata: {
      title: asText(metadata.title, fallbackTitle),
      author: asText(metadata.creator, 'Unknown author'),
    },
    coverDataUrl,
    toc: flattenNavigation(navigation),
    text: textParts.join('\n\n').slice(0, 250_000),
  }
}

export async function openEpub(file: ArrayBuffer): Promise<Book> {
  const { default: ePub } = await import('epubjs')
  const book = ePub()
  const input = normalizeEpubData(file)
  await assertNotProtected(input)
  await book.open(input, 'binary')
  return book
}

export function epubBookFromParsed(id: string, filename: string, fileSize: number, parsed: ParsedEpub): LibraryBook {
  const now = new Date().toISOString()
  return {
    id,
    title: parsed.metadata.title,
    author: parsed.metadata.author,
    progress: 0,
    chapter: parsed.toc[0]?.label ?? 'Ready to read',
    updated: now,
    cover: parsed.metadata.title,
    coverDataUrl: parsed.coverDataUrl,
    format: 'epub',
    fileName: filename,
    fileSize,
    toc: parsed.toc,
  }
}

export function pdfBookFromSource(
  id: string,
  filename: string,
  fileSize: number,
  title: string,
  author: string,
  sourceUrl?: string,
  coverUrl?: string,
): LibraryBook {
  return {
    id,
    title:
      title ||
      filename
        .replace(/\.pdf$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim() ||
      'Imported PDF',
    author: author || 'Unknown author',
    progress: 0,
    chapter: 'Ready to read',
    updated: new Date().toISOString(),
    cover: title,
    coverUrl,
    format: 'pdf',
    fileName: filename,
    fileSize,
    sourceUrl,
  }
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim()

// The text read so far: the opening, for who and where, then the latest pages up to the reader's
// exact place. Works on any opened book, so it does not need the saved text index.
export async function recapText(
  book: Book,
  place: { href?: string; chapterProgress: number; progress: number },
  head = 2_500,
  tail = 9_000,
): Promise<string> {
  try {
    await book.loaded.spine
    const items = spineSections(book)
    if (items.length === 0) return ''
    const href = (place.href ?? '').split('#')[0]
    let here = href
      ? items.findIndex((item) => item.href && (item.href.includes(href) || href.includes(item.href)))
      : -1
    if (here < 0)
      here = Math.min(items.length - 1, Math.floor(Math.max(0, Math.min(1, place.progress / 100)) * items.length))
    const sectionText = async (index: number) => {
      try {
        const section = book.spine.get(items[index].index)
        const root = (await section.load(book.load.bind(book))) as unknown as Element
        const text = squash((root.querySelector?.('body') ?? root).textContent ?? '')
        section.unload()
        return text
      } catch {
        return ''
      }
    }
    const current = await sectionText(here)
    let recent = current.slice(0, Math.floor(current.length * Math.max(0, Math.min(1, place.chapterProgress))))
    for (let index = here - 1; index >= 0 && recent.length < tail; index -= 1)
      recent = `${await sectionText(index)}\n\n${recent}`
    if (recent.length <= tail) return recent
    let opening = ''
    for (let index = 0; index < here && opening.length < head; index += 1)
      opening += `${opening ? '\n\n' : ''}${await sectionText(index)}`
    return `${opening.slice(0, head)}\n\n[…]\n\n${recent.slice(-tail)}`
  } catch {
    return ''
  }
}

const FRONT =
  /^(cover|title( page)?|half title|contents|table of contents|copyright|colophon|dedication|epigraph|front matter|project gutenberg|licen[cs]e|illustrations?|list of illustrations|imprint|by the same author|also by)\b/i
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// Where a book is opened the first time: past the cover, title page and licence text, at the first real section.
export function firstReadingIndex(toc: Array<{ label: string }>, title: string): number {
  const own = normalize(title)
  let index = 0
  while (index < toc.length - 1) {
    const label = toc[index].label.trim()
    const skip = !label || FRONT.test(label) || /^\d+$/.test(label) || normalize(label) === own
    if (!skip) break
    index += 1
  }
  return index
}
