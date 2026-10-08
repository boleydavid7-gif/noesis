// Keeps answers about a book to the part the reader has actually read.

// The text up to the reader's position. Progress is a percentage of the book.
export function readSoFar(text: string, progress: number): string {
  if (!(progress > 0)) return ''
  if (progress >= 99) return text
  return text.slice(0, Math.floor((text.length * progress) / 100))
}

// For "where was I?": the opening, to anchor who and where, and the most recent pages.
export function recapExcerpt(read: string, head = 2_500, tail = 9_000): string {
  if (read.length <= head + tail) return read
  return `${read.slice(0, head)}\n\n[…]\n\n${read.slice(-tail)}`
}

export const RECAP_QUESTION =
  'Where was I? Recap what has happened so far in a few short paragraphs, using only the text I have read. No spoilers.'
