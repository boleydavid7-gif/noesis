import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

export type BrainNoteKind = 'highlight' | 'idea' | 'question' | 'note'

export type BrainNote = {
  id: string
  kind: BrainNoteKind
  title: string
  body: string
  source: string
  createdAt: string
  synced?: boolean
}

const STORAGE_KEY = 'noesis:second-brain:v1'

function getStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function sortNotes(notes: BrainNote[]): BrainNote[] {
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function readLocalNotes(): BrainNote[] {
  const storage = getStorage()
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return sortNotes(
      parsed.filter((item): item is BrainNote => {
        if (!item || typeof item !== 'object') return false
        const value = item as Record<string, unknown>
        return typeof value.id === 'string' && typeof value.body === 'string' && typeof value.createdAt === 'string'
      }),
    )
  } catch {
    return []
  }
}

export function writeLocalNotes(notes: BrainNote[]): void {
  getStorage()?.setItem(STORAGE_KEY, JSON.stringify(sortNotes(notes).slice(0, 300)))
}

function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: getStorage() ?? undefined },
  })
}

let authPromise: Promise<SupabaseClient | null> | null = null

async function getAuthenticatedSupabase(): Promise<SupabaseClient | null> {
  if (!authPromise) {
    authPromise = (async () => {
      const client = getSupabase()
      if (!client) return null
      const existing = await client.auth.getSession()
      if (existing.data.session) return client
      const anonymous = await client.auth.signInAnonymously()
      return anonymous.error ? null : client
    })().catch(() => null)
  }
  return authPromise
}

function fromRemote(row: Record<string, unknown>): BrainNote {
  return {
    id: String(row.id),
    kind: (row.kind as BrainNoteKind) ?? 'note',
    title: String(row.title ?? 'Quick note'),
    body: String(row.notes ?? row.content ?? ''),
    source: String(row.source_url ?? 'Noesis'),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    synced: true,
  }
}

export async function hydrateRemoteNotes(local: BrainNote[]): Promise<BrainNote[]> {
  const client = await getAuthenticatedSupabase()
  if (!client) return sortNotes(local)
  const result = await client
    .from('knowledge_items')
    .select('id, kind, title, notes, content, source_url, created_at')
    .eq('kind', 'note')
    .order('created_at', { ascending: false })
    .limit(300)
  if (result.error || !result.data) return sortNotes(local)

  const remote = result.data.map((row) => fromRemote(row as Record<string, unknown>))
  const remoteIds = new Set(remote.map((note) => note.id))
  const pendingLocal = local.filter((note) => !note.synced && !remoteIds.has(note.id))
  const merged = sortNotes([...remote, ...pendingLocal])
  writeLocalNotes(merged)
  return merged
}

export async function persistNote(note: BrainNote): Promise<'remote' | 'local'> {
  const client = await getAuthenticatedSupabase()
  if (!client) {
    writeLocalNotes([note, ...readLocalNotes().filter((item) => item.id !== note.id)])
    return 'local'
  }

  const result = await client
    .from('knowledge_items')
    .insert({
      kind: 'note',
      title: note.title || 'Quick note',
      source_url: note.source || null,
      notes: note.body,
      content: note.body,
      status: 'ready',
    })
    .select('id, kind, title, notes, content, source_url, created_at')
    .single()

  if (result.error || !result.data) {
    writeLocalNotes([note, ...readLocalNotes().filter((item) => item.id !== note.id)])
    return 'local'
  }

  const saved = fromRemote(result.data as Record<string, unknown>)
  writeLocalNotes([saved, ...readLocalNotes().filter((item) => item.id !== note.id && item.id !== saved.id)])
  return 'remote'
}
