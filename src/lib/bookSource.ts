// Where a book in the library came from, in a few words: the library folder and its path, a storage service it was
// found in, a site, an outside store, or this device.
import type { CloudProviderId } from './cloudProviders'
import { cloudLabel } from './cloudFind'
import type { LibraryBook } from './library'

const shortDate = (value?: string) => {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

export function bookSource(book: LibraryBook, folderProvider?: CloudProviderId): string {
  if (book.format === 'external') return book.store ? `Read in ${book.store}` : 'Read elsewhere'
  if (book.fromFolder) {
    const where = folderProvider ? `${cloudLabel(folderProvider)} folder` : 'Library folder'
    return `${where} · ${book.fromFolder}`
  }
  if (book.foundIn) return `From ${cloudLabel(book.foundIn.provider)}`
  if (book.sourceName) return `From ${book.sourceName}`
  const added = shortDate(book.added)
  return added ? `Added ${added}` : 'Added by hand'
}
