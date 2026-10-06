import JSZip from 'jszip'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEpubFile, saveEpubFile, type LibraryBook } from './library'
import type { BrainNote } from './knowledge'

export type BackupPayload = { version: 1; createdAt: string; books: LibraryBook[]; notes: BrainNote[]; paths: unknown[] }

function getClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
}

function dataUrlToBytes(value: string): Uint8Array | null {
  const match = value.match(/^data:.*?;base64,(.*)$/)
  if (!match) return null
  const binary = atob(match[1])
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function createBackupBlob(books: LibraryBook[], notes: BrainNote[], paths: unknown[]): Promise<Blob> {
  const zip = new JSZip()
  const metadata: BackupPayload = { version: 1, createdAt: new Date().toISOString(), books, notes, paths }
  zip.file('manifest.json', JSON.stringify(metadata, null, 2))
  for (const book of books) {
    if (book.coverDataUrl) {
      const cover = dataUrlToBytes(book.coverDataUrl)
      if (cover) zip.file(`covers/${book.id}`, cover)
    }
  }
  for (const book of books.filter((item) => item.format === 'epub')) {
    const epub = await loadEpubFile(book.id).catch(() => null)
    if (epub) zip.file(`books/${book.id}.epub`, epub)
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function readBackup(file: Blob): Promise<BackupPayload> {
  const zip = await JSZip.loadAsync(file)
  const manifest = zip.file('manifest.json')
  if (!manifest) throw new Error('This is not a Noesis backup file.')
  const parsed = JSON.parse(await manifest.async('text')) as Partial<BackupPayload>
  if (parsed.version !== 1 || !Array.isArray(parsed.books) || !Array.isArray(parsed.notes) || !Array.isArray(parsed.paths)) throw new Error('This backup was created by an incompatible version of Noesis.')
  return { version: 1, createdAt: String(parsed.createdAt ?? new Date().toISOString()), books: parsed.books as LibraryBook[], notes: parsed.notes as BrainNote[], paths: parsed.paths }
}

export async function downloadBackup(books: LibraryBook[], notes: BrainNote[], paths: unknown[]): Promise<void> {
  const blob = await createBackupBlob(books, notes, paths)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = `noesis-backup-${new Date().toISOString().slice(0, 10)}.zip`; link.click(); URL.revokeObjectURL(url)
}

async function authenticatedClient(): Promise<{ client: SupabaseClient; userId: string } | null> {
  const client = getClient(); if (!client) return null
  const session = await client.auth.getSession()
  if (session.data.session?.user.id) return { client, userId: session.data.session.user.id }
  const anonymous = await client.auth.signInAnonymously()
  return anonymous.data.user?.id ? { client, userId: anonymous.data.user.id } : null
}

export async function uploadCloudBackup(books: LibraryBook[], notes: BrainNote[], paths: unknown[]): Promise<void> {
  const auth = await authenticatedClient(); if (!auth) throw new Error('Connect Supabase before using cloud backup.')
  const blob = await createBackupBlob(books, notes, paths)
  const result = await auth.client.storage.from('noesis-backups').upload(`${auth.userId}/latest.zip`, blob, { upsert: true, contentType: 'application/zip' })
  if (result.error) throw new Error(result.error.message)
}

export async function downloadCloudBackup(): Promise<BackupPayload> {
  const auth = await authenticatedClient(); if (!auth) throw new Error('Connect Supabase before using cloud backup.')
  const result = await auth.client.storage.from('noesis-backups').download(`${auth.userId}/latest.zip`)
  if (result.error || !result.data) throw new Error(result.error?.message ?? 'No cloud backup exists yet.')
  return readBackup(result.data)
}

export async function restoreBackup(file: Blob): Promise<BackupPayload> {
  const payload = await readBackup(file)
  const zip = await JSZip.loadAsync(file)
  for (const book of payload.books) {
    const fileEntry = zip.file(`books/${book.id}.epub`)
    if (fileEntry) await saveEpubFile(book.id, await fileEntry.async('arraybuffer'))
  }
  return payload
}
