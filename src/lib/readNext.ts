// Suggestions for what to read next, drawn from the reader's own notes and finished books.
// Runs on the device and uses no AI.

import { isStarted, type LibraryBook } from './library'
import { tokenize } from './retrieval'

type NoteLike = { title: string; body: string; tags?: string[] }

// The words the reader keeps coming back to, most telling first.
export function interestTerms(notes: NoteLike[], books: LibraryBook[], limit = 12): string[] {
  const counts = new Map<string, number>()
  const add = (text: string, weight: number) => {
    for (const term of new Set(tokenize(text))) counts.set(term, (counts.get(term) ?? 0) + weight)
  }
  for (const note of notes) add(`${note.title} ${note.body} ${(note.tags ?? []).join(' ')}`, 1)
  for (const book of books) {
    if (!book.finished) continue
    const stars = book.review?.stars ?? 3
    if (stars >= 3) add(`${book.title} ${book.description ?? ''}`, stars >= 4 ? 3 : 2)
  }
  // A word has to turn up more than once to count as an interest.
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

export type ReadNextPick = { book: LibraryBook; because: string[] }

// Books not yet started, ranked by how much they share with those interests.
export function libraryPicks(books: LibraryBook[], terms: string[], limit = 3): ReadNextPick[] {
  if (terms.length === 0) return []
  return books
    .filter((book) => !book.finished && book.progress < 5)
    .map((book) => {
      const words = new Set(
        tokenize(`${book.title} ${book.author} ${book.description ?? ''} ${(book.shelves ?? []).join(' ')}`),
      )
      const because = terms.filter((term) => words.has(term))
      return { book, because: because.slice(0, 3) }
    })
    .filter((pick) => pick.because.length > 0)
    .sort((a, b) => b.because.length - a.because.length)
    .slice(0, limit)
}

// A short search for free books on the same subject.
export const discoverQuery = (terms: string[]) => terms.slice(0, 2).join(' ')

export type Step = { id: string; label: string; done: boolean }

export function onboardingSteps(input: { books: LibraryBook[]; noteCount: number; pathCount: number }): Step[] {
  return [
    { id: 'add', label: 'Add a book', done: input.books.length > 0 },
    { id: 'read', label: 'Start reading it', done: input.books.some((book) => isStarted(book)) },
    { id: 'note', label: 'Save a highlight or note', done: input.noteCount > 0 },
    { id: 'plan', label: 'Plan something you want to learn', done: input.pathCount > 0 },
  ]
}
