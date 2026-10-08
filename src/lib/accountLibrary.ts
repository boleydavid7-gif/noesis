import { getAuthClient, isAnonymousUser } from './auth'
import {
  loadEpubFile,
  readLibraryBooks,
  saveBookText,
  saveEpubFile,
  writeLibraryBooks,
  type LibraryBook,
} from './library'
import { parseEpub } from './epub'
import {
  applyTombstones,
  mergeTombstones,
  pruneTombstones,
  readTombstones,
  sanitizeTombstones,
  writeTombstones,
  type Tombstones,
} from './tombstones'

const BUCKET = 'noesis-backups'
const MANIFEST_NAME = 'library/manifest.json'

type AccountLibraryManifest = {
  version: 1
  updatedAt: string
  books: LibraryBook[]
  tombstones?: Tombstones
}

function newer(localValue: string | undefined, remoteValue: string | undefined): boolean {
  return new Date(remoteValue ?? 0).valueOf() > new Date(localValue ?? 0).valueOf()
}

function mergeBooks(local: LibraryBook[], remote: LibraryBook[]): LibraryBook[] {
  const merged = new Map(local.map((book) => [book.id, book]))
  for (const book of remote) {
    const current = merged.get(book.id)
    if (!current || newer(current.updated, book.updated)) merged.set(book.id, book)
  }
  return [...merged.values()].sort((a, b) => new Date(b.updated || 0).valueOf() - new Date(a.updated || 0).valueOf())
}

function bookPath(userId: string, book: LibraryBook): string {
  const extension = book.format === 'pdf' ? 'pdf' : 'epub'
  return `${userId}/library/books/${book.id}.${extension}`
}

function manifestPath(userId: string): string {
  return `${userId}/${MANIFEST_NAME}`
}

function isMissingFile(error: { message?: string; statusCode?: string | number } | null): boolean {
  const status = Number(error?.statusCode)
  return status === 404 || /not found|does not exist/i.test(error?.message ?? '')
}

async function signedInUser() {
  const result = await getAuthClient().auth.getSession()
  if (result.error) throw new Error(result.error.message)
  const user = result.data.session?.user ?? null
  return user && !isAnonymousUser(user) ? user : null
}

async function readRemoteManifest(userId: string): Promise<AccountLibraryManifest | null> {
  const result = await getAuthClient().storage.from(BUCKET).download(manifestPath(userId))
  if (result.error) {
    if (isMissingFile(result.error)) return null
    throw new Error(`Supabase could not read your book library: ${result.error.message}`)
  }
  try {
    const parsed = JSON.parse(await result.data.text()) as Partial<AccountLibraryManifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.books)) return null
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
      books: parsed.books as LibraryBook[],
      tombstones: sanitizeTombstones(parsed.tombstones),
    }
  } catch {
    return null
  }
}

async function writeRemoteManifest(userId: string, books: LibraryBook[], tombstones: Tombstones): Promise<void> {
  const body: AccountLibraryManifest = { version: 1, updatedAt: new Date().toISOString(), books, tombstones }
  const result = await getAuthClient()
    .storage.from(BUCKET)
    .upload(manifestPath(userId), new Blob([JSON.stringify(body)], { type: 'application/json' }), {
      upsert: true,
      contentType: 'application/json',
    })
  if (result.error) throw new Error(`Supabase could not save your book library: ${result.error.message}`)
}

async function uploadLocalBook(userId: string, book: LibraryBook): Promise<void> {
  if (book.format !== 'epub' && book.format !== 'pdf') return
  const bytes = await loadEpubFile(book.id).catch(() => null)
  if (!bytes) return
  const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
  const result = await getAuthClient()
    .storage.from(BUCKET)
    .upload(bookPath(userId, book), new Blob([bytes], { type: contentType }), { upsert: true, contentType })
  if (result.error) throw new Error(`Supabase could not save ${book.title}: ${result.error.message}`)
}

async function restoreRemoteBook(userId: string, book: LibraryBook): Promise<void> {
  if (book.format !== 'epub' && book.format !== 'pdf') return
  const result = await getAuthClient().storage.from(BUCKET).download(bookPath(userId, book))
  if (result.error) {
    if (isMissingFile(result.error)) return
    throw new Error(`Supabase could not restore ${book.title}: ${result.error.message}`)
  }
  await saveEpubFile(book.id, await result.data.arrayBuffer())
  if (book.format === 'epub') {
    try {
      const bytes = await loadEpubFile(book.id)
      if (!bytes) return
      const parsed = await parseEpub(bytes, book.fileName || `${book.title}.epub`)
      if (parsed.text) await saveBookText(book.id, parsed.text)
    } catch {
      // The EPUB remains available even if indexing fails on this device.
    }
  }
}

/**
 * Sync the signed-in user's book catalog and individual book files through
 * Supabase Storage. This is intentionally separate from external cloud
 * providers, so a normal Noesis account can restore books without setup.
 */
export async function syncAccountLibrary(localBooks: LibraryBook[]): Promise<LibraryBook[]> {
  const user = await signedInUser()
  if (!user) return localBooks
  const remote = await readRemoteManifest(user.id)
  const tombstones = pruneTombstones(mergeTombstones(readTombstones(), remote?.tombstones ?? {}))
  const books = applyTombstones(
    'book',
    mergeBooks(mergeBooks(readLibraryBooks(), localBooks), remote?.books ?? []),
    tombstones,
  )
  writeTombstones(tombstones)
  await writeRemoteManifest(user.id, books, tombstones)
  for (const book of books) await uploadLocalBook(user.id, book)
  for (const book of books) await restoreRemoteBook(user.id, book)
  writeLibraryBooks(books)
  return books
}
