// Deletion records for sync. Without them a merge treats "missing on this
// device" as "not yet synced here" and brings deleted items back from another
// device. Each entry is last-write-wins, so deleting and later re-adding the
// same id (e.g. a hosted resource, whose id is deterministic) also converges.

export type TombstoneKind = 'book' | 'note' | 'path' | 'event' | 'card' | 'focus'
export type Tombstone = { at: string; deleted: boolean }
export type Tombstones = Record<string, Tombstone>

const KEY = 'noesis:tombstones:v1'
const DAY = 86_400_000
const KEEP_DELETED_DAYS = 180
const KEEP_RESTORED_DAYS = 30

export const tombstoneKey = (kind: TombstoneKind, id: string) => `${kind}:${id}`

export function sanitizeTombstones(value: unknown): Tombstones {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean: Tombstones = {}
  for (const [key, entry] of Object.entries(value)) {
    const candidate = entry as Partial<Tombstone> | null
    if (
      candidate &&
      typeof candidate.at === 'string' &&
      typeof candidate.deleted === 'boolean' &&
      !Number.isNaN(Date.parse(candidate.at))
    ) {
      clean[key] = { at: candidate.at, deleted: candidate.deleted }
    }
  }
  return clean
}

export function readTombstones(): Tombstones {
  try {
    return sanitizeTombstones(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return {}
  }
}

export function writeTombstones(tombstones: Tombstones): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tombstones))
  } catch {
    // Storage can be unavailable; sync then falls back to the old behaviour.
  }
}

// The later entry wins; on an exact tie a deletion wins.
export function mergeTombstones(a: Tombstones, b: Tombstones): Tombstones {
  const merged: Tombstones = { ...a }
  for (const [key, entry] of Object.entries(b)) {
    const current = merged[key]
    if (!current) merged[key] = entry
    else {
      const difference = Date.parse(entry.at) - Date.parse(current.at)
      if (difference > 0 || (difference === 0 && entry.deleted)) merged[key] = entry
    }
  }
  return merged
}

export function pruneTombstones(tombstones: Tombstones, now = Date.now()): Tombstones {
  const kept: Tombstones = {}
  for (const [key, entry] of Object.entries(tombstones)) {
    const age = now - Date.parse(entry.at)
    if (age <= (entry.deleted ? KEEP_DELETED_DAYS : KEEP_RESTORED_DAYS) * DAY) kept[key] = entry
  }
  return kept
}

export function applyTombstones<T extends { id: string }>(
  kind: TombstoneKind,
  items: T[],
  tombstones: Tombstones,
): T[] {
  return items.filter((item) => !tombstones[tombstoneKey(kind, item.id)]?.deleted)
}

export function markDeleted(kind: TombstoneKind, id: string, now = new Date()): void {
  writeTombstones({ ...readTombstones(), [tombstoneKey(kind, id)]: { at: now.toISOString(), deleted: true } })
}

// Only records something when the id was previously deleted, so ordinary
// updates to a book never grow the tombstone list.
export function markRestored(kind: TombstoneKind, id: string, now = new Date()): void {
  const current = readTombstones()
  const key = tombstoneKey(kind, id)
  if (!current[key]?.deleted) return
  writeTombstones({ ...current, [key]: { at: now.toISOString(), deleted: false } })
}

// Records a deletion for every id that was in `before` but is gone from `after`.
export function markRemoved(kind: TombstoneKind, before: Array<{ id: string }>, after: Array<{ id: string }>): void {
  const remaining = new Set(after.map((item) => item.id))
  const removed = before.filter((item) => !remaining.has(item.id))
  if (removed.length === 0) return
  const at = new Date().toISOString()
  const next = { ...readTombstones() }
  for (const item of removed) next[tombstoneKey(kind, item.id)] = { at, deleted: true }
  writeTombstones(next)
}
