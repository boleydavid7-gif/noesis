// Links into Libby. Libby's books can only be read in Libby (or sent to a Kindle in the US), so Noesis opens it at
// the right place: the shelf, the reader's library, or a search there.
import type { LibrarySystem } from './publicLibrary'

export const LIBBY_HOME = 'https://libbyapp.com/'
export { LIBBY_SHELF } from './loans'

export const libbyLibrary = (library: LibrarySystem | null) =>
  library?.libbyKey ? `https://libbyapp.com/library/${encodeURIComponent(library.libbyKey)}` : LIBBY_HOME

export function libbySearch(library: LibrarySystem | null, query: string): string {
  const words = query.trim()
  if (!library?.libbyKey) return LIBBY_HOME
  const key = encodeURIComponent(library.libbyKey)
  return words
    ? `https://libbyapp.com/search/${key}/search/query-${encodeURIComponent(words)}/page-1`
    : `https://libbyapp.com/library/${key}`
}
