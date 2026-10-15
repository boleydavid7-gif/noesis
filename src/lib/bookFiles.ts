import { downloadAccountBook, indexDownloadedBook } from './accountLibrary'
import { downloadCloudBook } from './cloudSync'
import { downloadById, findInStorage } from './cloudFind'
import { readCloudConnections } from './cloudProviders'
import { loadEpubFile, readLibraryBooks, saveEpubFile, upsertLibraryBook, type LibraryBook } from './library'

export class BookNotFoundError extends Error {
  constructor() {
    super('Book not found. It is not on this device or in your connected cloud.')
  }
}

/** Looks for a book's file in the account's storage, then each connected cloud's Noesis folder, then anywhere in it. */
async function findInCloud(book: LibraryBook): Promise<ArrayBuffer | null> {
  try {
    const fromAccount = await downloadAccountBook(book)
    if (fromAccount) return fromAccount
  } catch {
    // Try the connected clouds next.
  }
  for (const connection of readCloudConnections()) {
    try {
      const bytes = await downloadCloudBook(connection, book)
      if (bytes) return bytes
    } catch {
      // An expired or unreachable cloud is skipped; the next one may have it.
    }
  }
  // Then anywhere in the person's own storage: where it was found before, else by its file name and size.
  if (!book.fileName) return null
  const readers = readCloudConnections().filter((connection) => connection.readsFolders)
  const first = book.foundIn ? readers.filter((connection) => connection.provider === book.foundIn!.provider) : []
  for (const connection of [...first, ...readers.filter((each) => !first.includes(each))]) {
    try {
      const place =
        book.foundIn?.provider === connection.provider
          ? { id: book.foundIn.id }
          : await findInStorage(connection, book.fileName, book.fileSize)
      if (!place) continue
      const bytes = await downloadById(connection, place)
      if (book.fileSize && bytes.byteLength !== book.fileSize && book.foundIn?.provider !== connection.provider)
        continue
      if (book.foundIn?.id !== place.id) {
        const current = readLibraryBooks().find((item) => item.id === book.id) ?? book
        upsertLibraryBook({ ...current, foundIn: { provider: connection.provider, id: place.id } })
      }
      return bytes
    } catch {
      // Not there, or that storage could not be reached: the next one.
    }
  }
  return null
}

/**
 * The book's file: from this device if it is here, otherwise fetched from the cloud and kept for next time.
 * Throws BookNotFoundError when it is in neither place.
 */
export async function openBookFile(book: LibraryBook): Promise<ArrayBuffer> {
  const local = await loadEpubFile(book.id).catch(() => null)
  if (local) return local
  const remote = await findInCloud(book)
  if (!remote) throw new BookNotFoundError()
  await saveEpubFile(book.id, remote).catch(() => undefined)
  void indexDownloadedBook(book, remote)
  return remote
}
