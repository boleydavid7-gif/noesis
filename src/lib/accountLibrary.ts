import { getAuthClient, isAnonymousUser } from './auth'
import { loadEpubFile, readLibraryBooks, saveBookText, writeLibraryBooks, type LibraryBook } from './library'
import { parseEpub } from './epub'
import { sanitizeSettings, type Settings } from './settings'
import { mergeDiary, readDiary, writeDiary, type DiaryEntry } from './diary'
import { mergeBundles, sanitizeBundle, type SyncBundle } from './syncData'
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
const DATA_NAME = 'data/state.json'

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

// Returns true when the book's file is now in the cloud.
async function uploadLocalBook(userId: string, book: LibraryBook): Promise<boolean> {
  if (book.format !== 'epub' && book.format !== 'pdf') return true
  const bytes = await loadEpubFile(book.id).catch(() => null)
  if (!bytes) return false
  const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
  const result = await getAuthClient()
    .storage.from(BUCKET)
    .upload(bookPath(userId, book), new Blob([bytes], { type: contentType }), { upsert: true, contentType })
  if (result.error) throw new Error(`Supabase could not save ${book.title}: ${result.error.message}`)
  return true
}

/** A small file of the person's own (their font) kept in the account's storage. */
export async function uploadAccountAsset(name: string, bytes: ArrayBuffer, contentType: string): Promise<boolean> {
  const user = await signedInUser()
  if (!user) return false
  const result = await getAuthClient()
    .storage.from(BUCKET)
    .upload(`${user.id}/assets/${name}`, new Blob([bytes], { type: contentType }), { upsert: true, contentType })
  if (result.error) throw new Error(`Supabase could not save ${name}: ${result.error.message}`)
  return true
}

export async function downloadAccountAsset(name: string): Promise<ArrayBuffer | null> {
  const user = await signedInUser()
  if (!user) return null
  const result = await getAuthClient().storage.from(BUCKET).download(`${user.id}/assets/${name}`)
  if (result.error) {
    if (isMissingFile(result.error)) return null
    throw new Error(`Supabase could not fetch ${name}: ${result.error.message}`)
  }
  return result.data.arrayBuffer()
}

/** The book's file from the signed-in account's storage, or null when it is not there. */
export async function downloadAccountBook(book: LibraryBook): Promise<ArrayBuffer | null> {
  if (book.format !== 'epub' && book.format !== 'pdf') return null
  const user = await signedInUser()
  if (!user) return null
  const result = await getAuthClient().storage.from(BUCKET).download(bookPath(user.id, book))
  if (result.error) {
    if (isMissingFile(result.error)) return null
    throw new Error(`Supabase could not fetch ${book.title}: ${result.error.message}`)
  }
  return result.data.arrayBuffer()
}

/** Makes the text index for a book that has just come down from the cloud. Best effort. */
export async function indexDownloadedBook(book: LibraryBook, bytes: ArrayBuffer): Promise<void> {
  if (book.format !== 'epub') return
  try {
    const parsed = await parseEpub(bytes, book.fileName || `${book.title}.epub`)
    if (parsed.text) await saveBookText(book.id, parsed.text)
  } catch {
    // The EPUB remains readable even if indexing fails on this device.
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
  const inCloud = new Set<string>()
  // A file already uploaded (here or on another device) is not sent again.
  for (const book of books) {
    if (book.cloudAt) inCloud.add(book.id)
    else if (await uploadLocalBook(user.id, book)) inCloud.add(book.id)
  }
  const stamp = new Date().toISOString()
  // A book counts as synced once its file is in the cloud, or for links, once its entry is.
  // Files themselves come down only when a book is opened (see bookFiles.ts).
  const marked = books.map((book) =>
    inCloud.has(book.id) ? { ...book, cloudAt: book.cloudAt ?? stamp } : { ...book, cloudAt: undefined },
  )
  writeLibraryBooks(marked)
  return marked
}

type SettingsFile = { version: 1; updatedAt: string; settings: unknown }
const SETTINGS_NAME = 'data/settings.json'

/**
 * Keeps colours, look and reading preferences the same on every device signed in to the account.
 * The newer copy wins. Returns the account's settings when they are newer than this device's, else null.
 * Whether to sync at all stays a per-device choice and is never overwritten.
 */
export async function syncAccountSettings(
  local: Settings,
  localStamp: string,
): Promise<{ settings: Settings; stamp: string } | null> {
  const user = await signedInUser()
  if (!user) return null
  const storage = getAuthClient().storage.from(BUCKET)
  const path = `${user.id}/${SETTINGS_NAME}`
  const download = await storage.download(path)
  let remote: SettingsFile | null = null
  if (download.error) {
    if (!isMissingFile(download.error))
      throw new Error(`Supabase could not read your settings: ${download.error.message}`)
  } else {
    try {
      const parsed = JSON.parse(await download.data.text()) as Partial<SettingsFile>
      if (parsed.version === 1 && typeof parsed.updatedAt === 'string' && parsed.settings)
        remote = parsed as SettingsFile
    } catch {
      remote = null
    }
  }
  if (remote && (!localStamp || newer(localStamp, remote.updatedAt))) {
    const incoming = sanitizeSettings(remote.settings)
    return { settings: { ...incoming, backup: local.backup }, stamp: remote.updatedAt }
  }
  if (remote && !newer(remote.updatedAt, localStamp)) return null
  const stamp = localStamp || new Date().toISOString()
  const body: SettingsFile = { version: 1, updatedAt: stamp, settings: local }
  const upload = await storage.upload(path, new Blob([JSON.stringify(body)], { type: 'application/json' }), {
    upsert: true,
    contentType: 'application/json',
  })
  if (upload.error) throw new Error(`Supabase could not save your settings: ${upload.error.message}`)
  return null
}

/** Small things kept on the device that should follow the person: their name, pictures, saved searches and the like. */
export const PREFERENCE_KEYS = [
  'noesis:profile:first-name:v1',
  'noesis:font:v1',
  'noesis:images:v1',
  'noesis:saved-searches:v1',
  'noesis:ambient:v1',
  'noesis:pace:v1',
  'noesis:home-shelf:v1',
  'noesis:planner:v1',
  'noesis:paths-guide:v1',
  'noesis:keep-banner:v1',
]
const PREFS_NAME = 'data/preferences.json'
const PREFS_META = 'noesis:preferences-meta'

type PrefValue = { v: string | null; t: string }
type PrefsFile = { version: 1; updatedAt: string; prefs: Record<string, PrefValue>; diary: DiaryEntry[] }

/**
 * Backs up those small preferences and the reading diary to the account. Each preference is kept per item:
 * the one changed most recently wins, and the diary is combined line by line. Returns the keys this device
 * took from the account, so the app can refresh what it shows.
 */
export async function syncAccountPreferences(storageArea: Storage = localStorage): Promise<string[]> {
  const user = await signedInUser()
  if (!user) return []
  const bucket = getAuthClient().storage.from(BUCKET)
  const path = `${user.id}/${PREFS_NAME}`
  let meta: Record<string, PrefValue> = {}
  try {
    meta = JSON.parse(storageArea.getItem(PREFS_META) ?? '{}') as Record<string, PrefValue>
  } catch {
    meta = {}
  }
  const now = new Date().toISOString()
  // Anything that differs from what was last in step with the account is a change made here.
  for (const key of PREFERENCE_KEYS) {
    const current = storageArea.getItem(key)
    if (current !== (meta[key]?.v ?? null)) meta[key] = { v: current, t: now }
  }
  const download = await bucket.download(path)
  let remote: PrefsFile | null = null
  if (download.error) {
    if (!isMissingFile(download.error))
      throw new Error(`Supabase could not read your preferences: ${download.error.message}`)
  } else {
    try {
      const parsed = JSON.parse(await download.data.text()) as Partial<PrefsFile>
      if (parsed.version === 1 && parsed.prefs && typeof parsed.prefs === 'object') remote = parsed as PrefsFile
    } catch {
      remote = null
    }
  }
  const taken: string[] = []
  const merged: Record<string, PrefValue> = { ...(remote?.prefs ?? {}) }
  for (const key of PREFERENCE_KEYS) {
    const mine = meta[key]
    const theirs = remote?.prefs?.[key]
    if (theirs && (!mine || (mine.v !== theirs.v && newer(mine.t, theirs.t)))) {
      if (theirs.v === null) storageArea.removeItem(key)
      else storageArea.setItem(key, theirs.v)
      meta[key] = theirs
      taken.push(key)
      merged[key] = theirs
    } else if (mine && (mine.v !== null || theirs)) {
      merged[key] = mine
    }
  }
  const diary = mergeDiary(readDiary(), Array.isArray(remote?.diary) ? remote.diary : [])
  if (JSON.stringify(diary) !== JSON.stringify(readDiary())) writeDiary(diary)
  const body: PrefsFile = { version: 1, updatedAt: now, prefs: merged, diary }
  if (
    !remote ||
    JSON.stringify(remote.prefs) !== JSON.stringify(merged) ||
    JSON.stringify(remote.diary) !== JSON.stringify(diary)
  ) {
    const upload = await bucket.upload(path, new Blob([JSON.stringify(body)], { type: 'application/json' }), {
      upsert: true,
      contentType: 'application/json',
    })
    if (upload.error) throw new Error(`Supabase could not save your preferences: ${upload.error.message}`)
  }
  try {
    storageArea.setItem(PREFS_META, JSON.stringify(meta))
  } catch {
    // Without the note, the next sync simply treats this device's values as fresh changes.
  }
  return taken
}

type AccountDataFile = { version: 1; updatedAt: string; bundle: SyncBundle; tombstones?: Tombstones }

/**
 * Syncs the calendar, focus steps and review cards through the signed-in
 * account's private storage. Newer edits win per item, and deletions recorded
 * on any device are applied everywhere. Returns what this device should now show.
 */
export async function syncAccountBundle(local: SyncBundle): Promise<SyncBundle> {
  const user = await signedInUser()
  if (!user) return local
  const storage = getAuthClient().storage.from(BUCKET)
  const path = `${user.id}/${DATA_NAME}`
  const download = await storage.download(path)
  let remote: AccountDataFile | null = null
  if (download.error) {
    if (!isMissingFile(download.error))
      throw new Error(`Supabase could not read your synced data: ${download.error.message}`)
  } else {
    try {
      const parsed = JSON.parse(await download.data.text()) as Partial<AccountDataFile>
      const bundle = parsed.version === 1 ? sanitizeBundle(parsed.bundle) : undefined
      if (bundle)
        remote = {
          version: 1,
          updatedAt: String(parsed.updatedAt ?? ''),
          bundle,
          tombstones: sanitizeTombstones(parsed.tombstones),
        }
    } catch {
      remote = null
    }
  }
  const tombstones = pruneTombstones(mergeTombstones(readTombstones(), remote?.tombstones ?? {}))
  const merged = mergeBundles(local, remote?.bundle, tombstones)
  writeTombstones(tombstones)
  const body: AccountDataFile = { version: 1, updatedAt: new Date().toISOString(), bundle: merged, tombstones }
  const upload = await storage.upload(path, new Blob([JSON.stringify(body)], { type: 'application/json' }), {
    upsert: true,
    contentType: 'application/json',
  })
  if (upload.error) throw new Error(`Supabase could not save your synced data: ${upload.error.message}`)
  return merged
}
