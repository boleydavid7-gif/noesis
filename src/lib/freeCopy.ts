import { createContext } from 'react'
import { matchScore, type ResolvedBook } from './pathPlan'

// A free, legal copy of a book found through the same search the Explore page uses.
export type FreeCopy = {
  id: string
  title: string
  author: string
  year?: number
  coverUrl?: string
  description?: string
  source: string
  sourceUrl: string
  downloadUrl?: string
  readerUrl?: string
  accessType?: 'public' | 'borrow'
  free: boolean
  format: string
  kind: 'book' | 'article'
}

// Lets a book card hand a free copy to the app to open or import.
export const FreeCopyContext = createContext<((copy: FreeCopy) => void | Promise<void>) | null>(null)

// Looks for open copies (public domain or openly licensed) of one book. Borrow-only
// and article results are left out, since they cannot be imported.
export async function findFreeCopies(book: Pick<ResolvedBook, 'title' | 'authors'>): Promise<FreeCopy[]> {
  const author = book.authors[0] ?? ''
  const query = `${book.title} ${author}`.trim()
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
  if (!response.ok) throw new Error('The free-book search is unavailable right now.')
  const body = (await response.json()) as { ok?: boolean; results?: FreeCopy[] }
  if (!body.ok) throw new Error('The free-book search is unavailable right now.')
  return (body.results ?? [])
    .filter(
      (item) =>
        item.kind === 'book' &&
        item.free &&
        item.accessType !== 'borrow' &&
        (item.downloadUrl || item.readerUrl) &&
        matchScore({ title: item.title, authors: item.author.split(/,\s*/) }, book.title, '') > 0,
    )
    .slice(0, 3)
}
