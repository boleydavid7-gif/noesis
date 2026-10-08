import { chunkBook, retrieveChunks } from './retrieval'

export type LibraryHit = { bookId: string; title: string; author: string; text: string; score: number }

type Searchable = { id: string; title: string; author: string }

// Searches the text of every book that has been indexed, on the device.
export async function searchLibrary(
  books: Searchable[],
  query: string,
  loadText: (id: string) => Promise<string | null>,
  limit = 8,
): Promise<LibraryHit[]> {
  const hits: LibraryHit[] = []
  for (const book of books) {
    const text = await loadText(book.id).catch(() => null)
    if (!text) continue
    for (const chunk of retrieveChunks(chunkBook(text), query, 3)) {
      hits.push({ bookId: book.id, title: book.title, author: book.author, text: chunk.text, score: chunk.score })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

// A short phrase from a passage that the reader's own in-book search can find again.
export function searchPhrase(text: string, query: string): string {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []
  const sentences = text.split(/(?<=[.!?])\s+/)
  const best =
    sentences.find((sentence) => terms.some((term) => sentence.toLowerCase().includes(term))) ?? sentences[0] ?? text
  return best.split(/\s+/).slice(0, 6).join(' ').replace(/[“”"]/g, '')
}

// The passage cut to a readable excerpt around the first matching word.
export function excerpt(text: string, query: string, length = 280): string {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  const lower = text.toLowerCase()
  const at =
    terms
      .map((term) => lower.indexOf(term))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - Math.floor(length / 3))
  const piece = text.slice(start, start + length).trim()
  return `${start > 0 ? '…' : ''}${piece}${start + length < text.length ? '…' : ''}`
}
