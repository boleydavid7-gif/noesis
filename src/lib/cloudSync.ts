import { loadEpubFile, saveEpubFile, type LibraryBook } from './library'
import type { BrainNote } from './knowledge'
import { readCloudFile, writeCloudFile, type CloudConnection } from './cloudProviders'

export type CloudSyncState = {
  books: LibraryBook[]
  notes: BrainNote[]
  paths: unknown[]
}

type CloudManifest = CloudSyncState & { version: 2; updatedAt: string }

function text(value: ArrayBuffer): string {
  return new TextDecoder().decode(value)
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' })
}

function newer(localValue: string | undefined, remoteValue: string | undefined): boolean {
  return new Date(remoteValue ?? 0).valueOf() > new Date(localValue ?? 0).valueOf()
}

function mergeById<T extends { id: string; updated?: string; createdAt?: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map(local.map((item) => [item.id, item]))
  for (const item of remote) {
    const current = merged.get(item.id)
    if (!current || newer(current.updated ?? current.createdAt, item.updated ?? item.createdAt)) merged.set(item.id, item)
  }
  return [...merged.values()].sort((a, b) => new Date(b.updated ?? b.createdAt ?? 0).valueOf() - new Date(a.updated ?? a.createdAt ?? 0).valueOf())
}

function mergePaths(local: unknown[], remote: unknown[]): unknown[] {
  const localPaths = local.filter((item): item is { id: string; createdAt?: string } => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'))
  const remotePaths = remote.filter((item): item is { id: string; createdAt?: string } => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'))
  return mergeById(localPaths, remotePaths)
}

async function readManifest(connection: CloudConnection): Promise<CloudManifest | null> {
  const bytes = await readCloudFile(connection, 'manifest.json')
  if (!bytes) return null
  try {
    const parsed = JSON.parse(text(bytes)) as Partial<CloudManifest>
    if (parsed.version !== 2 || !Array.isArray(parsed.books) || !Array.isArray(parsed.notes) || !Array.isArray(parsed.paths)) return null
    return { version: 2, updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()), books: parsed.books as LibraryBook[], notes: parsed.notes as BrainNote[], paths: parsed.paths }
  } catch {
    return null
  }
}

async function restoreRemoteBooks(connection: CloudConnection, books: LibraryBook[]): Promise<void> {
  for (const book of books.filter((item) => item.format === 'epub' || item.format === 'pdf')) {
    const extension = book.format === 'pdf' ? 'pdf' : 'epub'
    const bytes = await readCloudFile(connection, `books/${book.id}.${extension}`)
    if (bytes) await saveEpubFile(book.id, bytes)
  }
}

async function uploadLocalBooks(connection: CloudConnection, books: LibraryBook[]): Promise<void> {
  for (const book of books.filter((item) => item.format === 'epub' || item.format === 'pdf')) {
    const bytes = await loadEpubFile(book.id).catch(() => null)
    if (bytes) {
      const extension = book.format === 'pdf' ? 'pdf' : 'epub'
      const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
      await writeCloudFile(connection, `books/${book.id}.${extension}`, new Blob([bytes], { type: contentType }), contentType)
    }
  }
}

export async function syncCloudState(connection: CloudConnection, local: CloudSyncState): Promise<CloudSyncState> {
  const remote = await readManifest(connection)
  const merged: CloudSyncState = remote
    ? { books: mergeById(local.books, remote.books), notes: mergeById(local.notes, remote.notes), paths: mergePaths(local.paths, remote.paths) }
    : local
  const manifest: CloudManifest = { version: 2, updatedAt: new Date().toISOString(), ...merged }
  await writeCloudFile(connection, 'manifest.json', jsonBlob(manifest), 'application/json')
  await uploadLocalBooks(connection, merged.books)
  await restoreRemoteBooks(connection, merged.books)
  return merged
}
