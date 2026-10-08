import type { Book, NavItem } from 'epubjs'
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
    coverDataUrl = coverUrl ? await blobToDataUrl(coverUrl) : undefined
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
  await book.open(normalizeEpubData(file), 'binary')
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
