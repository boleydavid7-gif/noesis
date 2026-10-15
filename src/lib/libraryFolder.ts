import { isImportable } from './convert'
import type { LibraryFolder } from './cloudFind'

/*
 * The library folder: a folder in the person's OneDrive, Google Drive or Dropbox that Noesis keeps the library in
 * step with. Books new to the folder come in; a newer file of a book that came from it replaces the old one (notes,
 * highlights and place stay); a book already in the library (added by hand, or on another device) is linked, never
 * added twice; a book removed from Noesis is not brought back. Which folder, and which book came from which path,
 * are kept as preferences, so every device signed in to the account follows the same folder.
 */

export const FOLDER_KEY = 'noesis:library-folder:v1'
export const FOLDER_BOOKS_KEY = 'noesis:folder-books:v1'

export type FolderBooks = Record<string, { bookId: string; size: number }>

function read<T>(key: string, fallback: T, area: Storage = localStorage): T {
  try {
    const raw = area.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown, area: Storage = localStorage): void {
  try {
    if (value === undefined) area.removeItem(key)
    else area.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full: the next look adds nothing twice anyway, books are matched by name and size.
  }
}

export const chosenLibraryFolder = () => read<LibraryFolder | undefined>(FOLDER_KEY, undefined)
export const chooseLibraryFolder = (folder: LibraryFolder | undefined) => write(FOLDER_KEY, folder)
export const folderBooks = () => read<FolderBooks>(FOLDER_BOOKS_KEY, {})
export const saveFolderBooks = (known: FolderBooks) => write(FOLDER_BOOKS_KEY, known)

type ShelfFile = { id: string; fileName?: string; fileSize?: number }

/** The same file: the same name (case aside) and, when both sizes are known, the same size. */
export const sameFile = (book: ShelfFile, name: string, size?: number) =>
  Boolean(book.fileName) &&
  book.fileName!.toLowerCase() === name.toLowerCase() &&
  (!book.fileSize || !size || book.fileSize === size)

/** The file's own name from a path in the folder ("Stoics/Meditations.epub" → "Meditations.epub"). */
export const fileNameOf = (path: string) => path.split('/').pop() ?? path

/**
 * What one look through the folder does: add each new file once (a file at two paths is one book, `same`), link a
 * file the library already has (added by hand, or on another device), replace the file of a book that came from the
 * folder when it changed size, and never bring back a book removed from Noesis.
 */
export function planFolderScan(
  files: readonly { path: string; size: number }[],
  known: FolderBooks,
  shelf: readonly ShelfFile[],
): {
  add: string[]
  replace: { path: string; bookId: string }[]
  link: { path: string; bookId: string }[]
  same: { path: string; as: string }[]
} {
  const add: string[] = []
  const replace: { path: string; bookId: string }[] = []
  const link: { path: string; bookId: string }[] = []
  const same: { path: string; as: string }[] = []
  const onShelf = new Set(shelf.map((book) => book.id))
  const firstOf = new Map<string, string>()
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  for (const file of sorted) {
    const name = fileNameOf(file.path)
    if (!isImportable(name) || name.startsWith('.')) continue
    const before = known[file.path]
    if (!before) {
      const key = `${name.toLowerCase()}\n${file.size}`
      const there = shelf.find((book) => sameFile(book, name, file.size))
      if (there) link.push({ path: file.path, bookId: there.id })
      else if (firstOf.has(key)) same.push({ path: file.path, as: firstOf.get(key)! })
      else {
        firstOf.set(key, file.path)
        add.push(file.path)
      }
    } else if (before.bookId && before.size !== file.size && onShelf.has(before.bookId))
      replace.push({ path: file.path, bookId: before.bookId })
  }
  return { add, replace, link, same }
}
