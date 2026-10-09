import { downloadAccountBook, indexDownloadedBook } from './accountLibrary'
import { downloadCloudBook } from './cloudSync'
import { readCloudConnections } from './cloudProviders'
import { loadEpubFile, saveEpubFile, type LibraryBook } from './library'

export class BookNotFoundError extends Error {
  constructor() {
    super('Book not found. It is not on this device or in your connected cloud.')
  }
}

/** Looks for a book's file in the account's storage, then in each connected cloud's Noesis folder. */
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
