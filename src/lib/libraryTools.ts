import type { LibraryBook } from './library'

const squash = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Books that look like the same one added twice: the same title and author, or the same title and file size.
export function duplicateGroups(books: LibraryBook[]): LibraryBook[][] {
  const groups = new Map<string, LibraryBook[]>()
  const add = (key: string, book: LibraryBook) => {
    const list = groups.get(key) ?? []
    if (!list.includes(book)) list.push(book)
    groups.set(key, list)
  }
  for (const book of books) {
    const title = squash(book.title)
    if (!title) continue
    const author = squash(book.author)
    if (author && author !== 'imported pdf' && author !== 'unknown author') add(`a:${title}|${author}`, book)
    if (book.fileSize) add(`s:${title}|${book.fileSize}`, book)
  }
  const seen = new Set<string>()
  const result: LibraryBook[][] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const ids = list.map((book) => book.id).sort()
    const key = ids.join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(list.sort((a, b) => (a.added ?? a.updated).localeCompare(b.added ?? b.updated)))
  }
  return result
}

// A picture chosen as a cover, shrunk so it stays small to store and sync.
export function resizeCover(file: File, maxWidth = 420): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxWidth / image.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('Your browser could not read that picture.'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not a picture Noesis can read.'))
    }
    image.src = url
  })
}
