import { chunkBook, retrieveChunks } from './retrieval'
import { blendScore, dot, type Embed } from './semantic'

export type LibraryHit = { bookId: string; title: string; author: string; text: string; score: number }

type Searchable = { id: string; title: string; author: string }

// What the search needs to find passages by meaning as well as by words.
export type MeaningSearch = {
  embed: Embed
  // The vectors for a book's passages, made once and kept.
  vectorsFor: (
    bookId: string,
    passages: string[],
    onProgress?: (done: number, total: number) => void,
  ) => Promise<Float32Array[]>
}

// Searches the text of every book that has been indexed, on the device. With a model on the device it
// also finds passages that mean the same thing as the question in different words.
export async function searchLibrary(
  books: Searchable[],
  query: string,
  loadText: (id: string) => Promise<string | null>,
  limit = 8,
  meaning?: MeaningSearch,
  onStep?: (message: string) => void,
): Promise<LibraryHit[]> {
  type Candidate = { book: Searchable; text: string; keyword: number; meaning: number }
  const candidates: Candidate[] = []
  let queryVector: Float32Array | null = null
  if (meaning) {
    try {
      onStep?.('Getting the model ready…')
      queryVector = (await meaning.embed([query]))[0] ?? null
    } catch {
      queryVector = null
    }
  }
  for (const [index, book] of books.entries()) {
    const text = await loadText(book.id).catch(() => null)
    if (!text) continue
    const chunks = chunkBook(text)
    const lexical = new Map(retrieveChunks(chunks, query, 10).map((chunk) => [chunk.id, chunk.score]))
    const close = new Map<number, number>()
    if (meaning && queryVector) {
      try {
        onStep?.(`Reading “${book.title}” (${index + 1} of ${books.length})…`)
        const vectors = await meaning.vectorsFor(
          book.id,
          chunks.map((chunk) => chunk.text),
          (done, total) => onStep?.(`Reading “${book.title}” (${done} of ${total} passages)…`),
        )
        vectors
          .map((vector, at) => ({ at, score: dot(queryVector as Float32Array, vector) }))
          .filter((item) => item.score >= 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .forEach((item) => close.set(item.at, item.score))
      } catch {
        // Without the model this book is searched by words only.
      }
    }
    for (const id of new Set([...lexical.keys(), ...close.keys()])) {
      candidates.push({ book, text: chunks[id].text, keyword: lexical.get(id) ?? 0, meaning: close.get(id) ?? 0 })
    }
  }
  const best = Math.max(0.0001, ...candidates.map((item) => item.keyword))
  return candidates
    .map((item) => ({
      bookId: item.book.id,
      title: item.book.title,
      author: item.book.author,
      text: item.text,
      score: meaning ? blendScore(item.keyword / best, item.meaning) : item.keyword,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
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
