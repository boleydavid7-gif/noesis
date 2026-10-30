// A rabbit hole in a link: the questions, Noema's answers, the person's own words, the doors and the sources travel
// inside the link's fragment (never sent to a server). Guesses, what stuck, recall marks and books on this device stay
// here. Whoever opens it reads it and can keep a copy of their own.
import type { LearningPath } from './pathPlan'
import {
  newId,
  subjectOf,
  type Door,
  type DoorKind,
  type HoleOrigin,
  type Pick,
  type PickType,
  type Question,
} from './subjects'
import { packJson, unpackJson } from './share'

export type SharedQuestion = {
  id: string
  parentId?: string
  text: string
  hook?: string
  short?: string
  own?: string // the sharer's own words
  doors?: Door[]
  picks?: Array<Pick & { id: string }>
  askedAt: string
}
export type SharedHole = {
  v: 1
  title: string
  from?: { kind: HoleOrigin['kind']; title: string; quote?: string; url?: string }
  summary?: string
  questions: SharedQuestion[]
}

const MAX_QUESTIONS = 60
// Most messaging apps carry links of this length; past it, sources go first, then the latest questions.
export const MAX_LINK_CODE = 24_000
const DOOR_KINDS: DoorKind[] = ['deeper', 'side', 'curious']
const PICK_TYPES: PickType[] = ['read', 'watch', 'listen', 'book', 'try']

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const https = (value: unknown) => {
  const url = text(value, 600)
  return /^https:\/\//.test(url) ? url : undefined
}

export function sharedHole(path: LearningPath, withPicks = true): SharedHole {
  const subject = subjectOf(path)
  const from = subject.from
  const questions = [...subject.questions]
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt))
    .slice(0, MAX_QUESTIONS)
    .map((q): SharedQuestion => ({
      id: q.id,
      parentId: q.parentId,
      text: q.text,
      hook: q.hook,
      short: q.short,
      own: q.answer?.text,
      doors: q.doors?.length ? q.doors : undefined,
      picks:
        withPicks && q.picks?.length
          ? q.picks
              .filter((pick) => pick.url || pick.type === 'book')
              .slice(0, 6)
              .map((pick) => ({
                id: pick.id,
                type: pick.type,
                title: pick.title,
                source: pick.source,
                url: pick.url,
                minutes: pick.minutes,
                why: pick.why,
              }))
          : undefined,
      askedAt: q.askedAt,
    }))
  return {
    v: 1,
    title: path.title,
    from: from ? { kind: from.kind, title: from.title, quote: from.quote, url: from.url } : undefined,
    summary: subject.summary?.text,
    questions,
  }
}

// The link's code, made to fit: the whole hole, else without sources, else fewer questions.
export async function holeCode(path: LearningPath): Promise<string> {
  let code = await packJson(sharedHole(path))
  if (code.length <= MAX_LINK_CODE) return code
  const bare = sharedHole(path, false)
  code = await packJson(bare)
  while (code.length > MAX_LINK_CODE && bare.questions.length > 1) {
    bare.questions = bare.questions.slice(0, Math.floor(bare.questions.length * 0.75))
    code = await packJson(bare)
  }
  return code
}

export const holeLink = (origin: string, code: string) => `${origin}/#hole=${code}`

// Reads a shared hole back, keeping only what is well formed.
export async function readHoleCode(code: string): Promise<SharedHole | null> {
  const raw = (await unpackJson(code)) as Partial<SharedHole> | null
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.questions)) return null
  const title = text(raw.title, 120)
  const questions = raw.questions
    .slice(0, MAX_QUESTIONS)
    .filter((q): q is SharedQuestion => Boolean(q) && typeof q.id === 'string' && Boolean(text(q.text, 300)))
    .map((q): SharedQuestion => ({
      id: text(q.id, 80),
      parentId: q.parentId ? text(q.parentId, 80) : undefined,
      text: text(q.text, 300),
      hook: text(q.hook, 200) || undefined,
      short: text(q.short, 4_000) || undefined,
      own: text(q.own, 4_000) || undefined,
      doors: Array.isArray(q.doors)
        ? q.doors
            .filter((door) => DOOR_KINDS.includes(door?.kind) && text(door.text, 300))
            .slice(0, 6)
            .map((door) => ({ kind: door.kind, text: text(door.text, 300), hook: text(door.hook, 200) || undefined }))
        : undefined,
      picks: Array.isArray(q.picks)
        ? q.picks
            .filter((pick) => PICK_TYPES.includes(pick?.type) && text(pick.title, 200))
            .slice(0, 6)
            .map((pick) => ({
              id: text(pick.id, 80) || newId('pick'),
              type: pick.type,
              title: text(pick.title, 200),
              source: text(pick.source, 120),
              url: https(pick.url),
              minutes: typeof pick.minutes === 'number' && pick.minutes > 0 ? Math.round(pick.minutes) : undefined,
              why: text(pick.why, 300) || undefined,
            }))
        : undefined,
      askedAt: text(q.askedAt, 40) || new Date(0).toISOString(),
    }))
  if (!title || !questions.length) return null
  const from = raw.from && typeof raw.from === 'object' ? raw.from : undefined
  return {
    v: 1,
    title,
    from:
      from && text(from.title, 200) && ['book', 'note', 'page'].includes(from.kind)
        ? {
            kind: from.kind,
            title: text(from.title, 200),
            quote: text(from.quote, 1_200) || undefined,
            url: https(from.url),
          }
        : undefined,
    summary: text(raw.summary, 4_000) || undefined,
    questions,
  }
}

// A copy of a shared hole to keep: fresh ids, the sharer's own words left out (the reader writes their own), Noema's
// answers and the doors kept, every question open.
export function keepSharedHole(shared: SharedHole, now = new Date()): LearningPath {
  const stamp = now.toISOString()
  const area = { id: newId('area'), title: shared.title.slice(0, 60) }
  const ids = new Map(shared.questions.map((q) => [q.id, newId('q')]))
  const questions: Question[] = shared.questions.map((q) => ({
    id: ids.get(q.id)!,
    areaId: area.id,
    text: q.text,
    hook: q.hook,
    short: q.short,
    doors: q.doors,
    picks: q.picks?.map((pick) => ({ ...pick, id: newId('pick') })),
    parentId: q.parentId ? ids.get(q.parentId) : undefined,
    state: 'later',
    origin: q.parentId ? 'deeper' : 'start',
    askedAt: q.askedAt,
  }))
  const from = shared.from ? { ...shared.from } : undefined
  return {
    id: `path-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : newId('x')}`,
    title: shared.title,
    description: '',
    bookIds: [],
    createdAt: stamp,
    updated: stamp,
    subject: { areas: [area], questions, from },
  }
}
