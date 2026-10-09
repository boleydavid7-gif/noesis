import { loadEpubFile, readLibraryBooks, writeLibraryBooks, type LibraryBook } from './library'
import type { BrainNote } from './knowledge'
import { mergeById } from './merge'
import {
  applyTombstones,
  mergeTombstones,
  pruneTombstones,
  readTombstones,
  sanitizeTombstones,
  writeTombstones,
  type Tombstones,
} from './tombstones'
import { readCloudFile, writeCloudFile, type CloudConnection } from './cloudProviders'
import { mergeBundles, sanitizeBundle, type SyncBundle } from './syncData'

export type CloudSyncState = {
  books: LibraryBook[]
  notes: BrainNote[]
  paths: unknown[]
  bundle?: SyncBundle
}

type CloudManifest = CloudSyncState & { version: 2; updatedAt: string; tombstones?: Tombstones }

function text(value: ArrayBuffer): string {
  return new TextDecoder().decode(value)
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' })
}

function mergePaths(local: unknown[], remote: unknown[]): unknown[] {
  const localPaths = local.filter((item): item is { id: string; createdAt?: string } =>
    Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'),
  )
  const remotePaths = remote.filter((item): item is { id: string; createdAt?: string } =>
    Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'),
  )
  return mergeById(localPaths, remotePaths)
}

async function readManifest(connection: CloudConnection): Promise<CloudManifest | null> {
  const bytes = await readCloudFile(connection, 'manifest.json')
  if (!bytes) return null
  try {
    const parsed = JSON.parse(text(bytes)) as Partial<CloudManifest>
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.books) ||
      !Array.isArray(parsed.notes) ||
      !Array.isArray(parsed.paths)
    )
      return null
    return {
      version: 2,
      updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
      books: parsed.books as LibraryBook[],
      notes: parsed.notes as BrainNote[],
      paths: parsed.paths,
      bundle: sanitizeBundle(parsed.bundle),
      tombstones: sanitizeTombstones(parsed.tombstones),
    }
  } catch {
    return null
  }
}

const extensionFor = (book: LibraryBook) => (book.format === 'pdf' ? 'pdf' : 'epub')
const uploadedKey = (connection: CloudConnection) => `noesis:cloud-uploaded:${connection.provider}`

function readUploaded(connection: CloudConnection): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(uploadedKey(connection)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** The book's file from a connected cloud's Noesis folder, or null when it is not there. */
export async function downloadCloudBook(connection: CloudConnection, book: LibraryBook): Promise<ArrayBuffer | null> {
  if (book.format !== 'epub' && book.format !== 'pdf') return null
  return readCloudFile(connection, `books/${book.id}.${extensionFor(book)}`)
}

// Books travel to the cloud's Noesis folder once; files come back only when a book is opened (bookFiles.ts).
async function uploadLocalBooks(connection: CloudConnection, books: LibraryBook[]): Promise<void> {
  const uploaded = readUploaded(connection)
  for (const book of books.filter((item) => item.format === 'epub' || item.format === 'pdf')) {
    if (uploaded.has(book.id)) continue
    const bytes = await loadEpubFile(book.id).catch(() => null)
    if (!bytes) continue
    const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
    await writeCloudFile(
      connection,
      `books/${book.id}.${extensionFor(book)}`,
      new Blob([bytes], { type: contentType }),
      contentType,
    )
    uploaded.add(book.id)
    try {
      localStorage.setItem(uploadedKey(connection), JSON.stringify([...uploaded]))
    } catch {
      // Without the note, the book is simply sent again next time.
    }
  }
}

export async function syncCloudState(connection: CloudConnection, local: CloudSyncState): Promise<CloudSyncState> {
  // React state can be briefly stale during auth transitions. Read the durable
  // local catalog as well so a sign-out/sign-in cycle can never replace a
  // library with an empty in-memory value.
  const durableLocalBooks = mergeById(readLibraryBooks(), local.books)
  const remote = await readManifest(connection)
  const unfiltered: CloudSyncState = remote
    ? {
        books: mergeById(durableLocalBooks, remote.books),
        notes: mergeById(local.notes, remote.notes),
        paths: mergePaths(local.paths, remote.paths),
      }
    : { ...local, books: durableLocalBooks }
  // Deletions recorded on any device win over copies that device never saw.
  const tombstones = pruneTombstones(mergeTombstones(readTombstones(), remote?.tombstones ?? {}))
  const merged: CloudSyncState = {
    books: applyTombstones('book', unfiltered.books, tombstones),
    notes: applyTombstones('note', unfiltered.notes, tombstones),
    paths: applyTombstones('path', unfiltered.paths as Array<{ id: string }>, tombstones),
    bundle: local.bundle ? mergeBundles(local.bundle, remote?.bundle, tombstones) : remote?.bundle,
  }
  writeTombstones(tombstones)
  const manifest: CloudManifest = { version: 2, updatedAt: new Date().toISOString(), ...merged, tombstones }
  await writeCloudFile(connection, 'manifest.json', jsonBlob(manifest), 'application/json')
  await uploadLocalBooks(connection, merged.books)
  writeLibraryBooks(merged.books)
  return merged
}
