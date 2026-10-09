import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

export type BrainNoteKind = 'highlight' | 'idea' | 'question' | 'note' | 'connection'

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple' | 'teal'
export const HIGHLIGHT_COLORS: Array<{ id: HighlightColor; label: string; css: string }> = [
  { id: 'yellow', label: 'Yellow', css: '#f2d46b' },
  { id: 'green', label: 'Green', css: '#86d19a' },
  { id: 'blue', label: 'Blue', css: '#7fb8f2' },
  { id: 'pink', label: 'Pink', css: '#ef9ab0' },
  { id: 'orange', label: 'Orange', css: '#f0a868' },
  { id: 'purple', label: 'Purple', css: '#b79cef' },
  { id: 'teal', label: 'Teal', css: '#6fd3c9' },
]

export type BrainNoteLocation = {
  bookId?: string
  bookTitle?: string
  author?: string
  chapter?: string
  chapterIndex?: number
  page?: number
  href?: string
  cfi?: string
}

export type BrainNote = {
  id: string
  kind: BrainNoteKind
  title: string
  body: string
  source: string
  createdAt: string
  updated?: string // set when a note is edited, so edits win when devices sync
  synced?: boolean
  bookId?: string
  bookTitle?: string
  author?: string
  chapter?: string
  chapterIndex?: number
  page?: number
  href?: string
  cfi?: string
  tags?: string[]
  quote?: string // the passage a note was written about
  notebook?: string // a named folder the reader keeps this note in
  revisit?: string // a day (YYYY-MM-DD) the reader asked to see this note again
  color?: HighlightColor
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
  if (authPromise) {
    const cached = await authPromise
    if (cached) return cached
    authPromise = null
  }
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
  const rawContent = typeof row.content === 'string' ? row.content : ''
  let saved: Partial<BrainNote> = {}
  try {
    const parsed = JSON.parse(rawContent) as unknown
    if (parsed && typeof parsed === 'object' && (parsed as { __noesisBrainNote?: unknown }).__noesisBrainNote === 1)
      saved = parsed as Partial<BrainNote>
  } catch {
    // Older notes stored plain text in content.
  }
  const rawKind = row.kind ?? saved.kind
  const kind: BrainNoteKind =
    rawKind === 'highlight' || rawKind === 'idea' || rawKind === 'question' || rawKind === 'connection'
      ? rawKind
      : 'note'
  return {
    id: String(row.id),
    kind,
    title: String(row.title ?? saved.title ?? 'Quick note'),
    body: String(row.notes ?? saved.body ?? (rawContent.startsWith('{') ? '' : rawContent)),
    source: String(row.source_url ?? saved.source ?? 'Noesis'),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    synced: true,
    bookId: typeof saved.bookId === 'string' ? saved.bookId : undefined,
    bookTitle: typeof saved.bookTitle === 'string' ? saved.bookTitle : undefined,
    author: typeof saved.author === 'string' ? saved.author : undefined,
    chapter: typeof saved.chapter === 'string' ? saved.chapter : undefined,
    chapterIndex: typeof saved.chapterIndex === 'number' ? saved.chapterIndex : undefined,
    page: typeof saved.page === 'number' ? saved.page : undefined,
    href: typeof saved.href === 'string' ? saved.href : undefined,
    cfi: typeof saved.cfi === 'string' ? saved.cfi : undefined,
    tags: Array.isArray(saved.tags) ? saved.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    quote: typeof saved.quote === 'string' ? saved.quote : undefined,
    notebook: typeof saved.notebook === 'string' ? saved.notebook : undefined,
    revisit: typeof saved.revisit === 'string' ? saved.revisit : undefined,
    color: HIGHLIGHT_COLORS.some((item) => item.id === saved.color) ? saved.color : undefined,
  }
}

export async function hydrateRemoteNotes(local: BrainNote[]): Promise<BrainNote[]> {
  const client = await getAuthenticatedSupabase()
  if (!client) return sortNotes(local)
  const result = await client
    .from('knowledge_items')
    .select('id, kind, title, notes, content, source_url, created_at')
    .in('kind', ['note', 'highlight', 'idea', 'question', 'connection'])
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

  const user = await client.auth.getUser()
  if (user.error || !user.data.user) {
    writeLocalNotes([note, ...readLocalNotes().filter((item) => item.id !== note.id)])
    return 'local'
  }
  const result = await client
    .from('knowledge_items')
    .insert({
      user_id: user.data.user.id,
      kind: note.kind,
      title: note.title || 'Quick note',
      source_url: note.source || null,
      notes: note.body,
      content: JSON.stringify({ __noesisBrainNote: 1, ...note, synced: undefined }),
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

export async function syncPendingNotes(notes: BrainNote[]): Promise<BrainNote[]> {
  const pending = notes.filter((note) => !note.synced)
  for (const note of pending) await persistNote(note)
  return hydrateRemoteNotes(readLocalNotes())
}

const isRemoteId = (id: string) => !id.startsWith('local-')

// Saves an edit to a note. Notes that only exist on this device are just stored locally.
export async function updateNote(note: BrainNote): Promise<'remote' | 'local'> {
  writeLocalNotes([note, ...readLocalNotes().filter((item) => item.id !== note.id)])
  if (!isRemoteId(note.id)) return 'local'
  const client = await getAuthenticatedSupabase()
  if (!client) return 'local'
  const result = await client
    .from('knowledge_items')
    .update({
      kind: note.kind,
      title: note.title || 'Quick note',
      source_url: note.source || null,
      notes: note.body,
      content: JSON.stringify({ __noesisBrainNote: 1, ...note, synced: undefined }),
    })
    .eq('id', note.id)
  return result.error ? 'local' : 'remote'
}

export async function deleteNote(id: string): Promise<void> {
  writeLocalNotes(readLocalNotes().filter((item) => item.id !== id))
  if (!isRemoteId(id)) return
  const client = await getAuthenticatedSupabase()
  if (client) await client.from('knowledge_items').delete().eq('id', id)
}
