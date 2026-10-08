import {
  loadEpubFile,
  readLibraryBooks,
  saveBookText,
  saveEpubFile,
  writeLibraryBooks,
  type LibraryBook,
} from './library'
import { parseEpub } from './epub'
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

export type CloudSyncState = {
  books: LibraryBook[]
  notes: BrainNote[]
  paths: unknown[]
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
      tombstones: sanitizeTombstones(parsed.tombstones),
    }
  } catch {
    return null
  }
}

async function restoreRemoteBooks(connection: CloudConnection, books: LibraryBook[]): Promise<void> {
  for (const book of books.filter((item) => item.format === 'epub' || item.format === 'pdf')) {
    const extension = book.format === 'pdf' ? 'pdf' : 'epub'
    const bytes = await readCloudFile(connection, `books/${book.id}.${extension}`)
    if (bytes) {
      await saveEpubFile(book.id, bytes)
      if (book.format === 'epub') {
        try {
          const parsed = await parseEpub(bytes, book.fileName || `${book.title}.epub`)
          if (parsed.text) await saveBookText(book.id, parsed.text)
        } catch {
          // The EPUB itself remains readable even if text indexing fails.
        }
      }
    }
  }
}

async function uploadLocalBooks(connection: CloudConnection, books: LibraryBook[]): Promise<void> {
  for (const book of books.filter((item) => item.format === 'epub' || item.format === 'pdf')) {
    const bytes = await loadEpubFile(book.id).catch(() => null)
    if (bytes) {
      const extension = book.format === 'pdf' ? 'pdf' : 'epub'
      const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
      await writeCloudFile(
        connection,
        `books/${book.id}.${extension}`,
        new Blob([bytes], { type: contentType }),
        contentType,
      )
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
  }
  writeTombstones(tombstones)
  const manifest: CloudManifest = { version: 2, updatedAt: new Date().toISOString(), ...merged, tombstones }
  await writeCloudFile(connection, 'manifest.json', jsonBlob(manifest), 'application/json')
  await uploadLocalBooks(connection, merged.books)
  await restoreRemoteBooks(connection, merged.books)
  writeLibraryBooks(merged.books)
  return merged
}
