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

function flattenNavigation(items: NavItem[], output: Array<{ label: string; href: string }> = []): Array<{ label: string; href: string }> {
  for (const item of items) {
    output.push({ label: item.label, href: item.href })
    if (item.subitems) flattenNavigation(item.subitems, output)
  }
  return output
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
  await book.open(file)
  const metadata = await book.loaded.metadata
  const navigation = await book.loaded.navigation
  const coverUrl = await book.coverUrl()
  const coverDataUrl = coverUrl ? await blobToDataUrl(coverUrl) : undefined
  const spineItems = await book.loaded.spine
  const textParts: string[] = []
  for (const item of spineItems.slice(0, 120)) {
    try {
      const section = book.spine.get(item.index)
      const document = await (section.load(book.load.bind(book)) as unknown as Promise<Document>)
      const text = document.body?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (text) textParts.push(text)
      section.unload()
      if (textParts.join(' ').length >= 250_000) break
    } catch {
      // A malformed chapter should not prevent the book from importing.
    }
  }
  const fallbackTitle = filename.replace(/\.epub$/i, '').replace(/[-_]+/g, ' ').trim() || 'Untitled EPUB'
  return {
    metadata: {
      title: asText(metadata.title, fallbackTitle),
      author: asText(metadata.creator, 'Unknown author'),
    },
    coverDataUrl,
    toc: flattenNavigation(navigation.toc ?? []),
    text: textParts.join('\n\n').slice(0, 250_000),
  }
}

export async function openEpub(file: ArrayBuffer): Promise<Book> {
  const { default: ePub } = await import('epubjs')
  const book = ePub()
  await book.open(file)
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

export function pdfBookFromSource(id: string, filename: string, fileSize: number, title: string, author: string, sourceUrl?: string, coverUrl?: string): LibraryBook {
  return {
    id,
    title: title || filename.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported PDF',
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
