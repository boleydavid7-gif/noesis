import { parseEpub } from './epub'
import { loadEpubFile, saveBookText, type LibraryBook } from './library'

// Re-reads every stored EPUB and saves its text again. Books imported before
// text indexing worked have an empty index until this runs.
export async function rebuildTextIndex(
  books: LibraryBook[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ indexed: number; skipped: number }> {
  const epubs = books.filter((book) => book.format === 'epub')
  let indexed = 0
  let skipped = 0
  for (const [index, book] of epubs.entries()) {
    try {
      const data = await loadEpubFile(book.id)
      if (!data) {
        skipped += 1
      } else {
        const parsed = await parseEpub(data, book.fileName || `${book.title}.epub`)
        if (parsed.text) {
          await saveBookText(book.id, parsed.text)
          indexed += 1
        } else {
          skipped += 1
        }
      }
    } catch {
      skipped += 1
    }
    onProgress?.(index + 1, epubs.length)
  }
  return { indexed, skipped }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}
