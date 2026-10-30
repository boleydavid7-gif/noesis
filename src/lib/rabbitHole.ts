// The rabbit hole as a dive: a question, a guess, an answer, the learner's own words, and three doors on to the
// next question. Coming up again (climbing out) keeps what stuck and offers recall cards; coming back days later
// asks one recall question first. Pure, so it is tested alone (src/__tests__/rabbitHole.test.ts).
import type { LearningPath } from './pathPlan'
import {
  newId,
  removeQuestion,
  withQuestion,
  type Area,
  type Door,
  type DoorKind,
  type HoleOrigin,
  type Question,
  type Subject,
  type SubjectDraft,
} from './subjects'

const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const DAY = 86_400_000

export const DOOR_WORD: Record<DoorKind, string> = { deeper: 'Deeper', side: 'Sideways', curious: 'Curiouser' }
const DOOR_ORIGIN: Record<DoorKind, Question['origin']> = { deeper: 'deeper', side: 'side', curious: 'curious' }
export const doorOf = (question: Question): DoorKind | null =>
  question.origin === 'deeper'
    ? 'deeper'
    : question.origin === 'side'
      ? 'side'
      : question.origin === 'curious'
        ? 'curious'
        : null

export const isExplained = (question: Question) => question.state === 'answered' && Boolean(question.answer)
export const isVisited = (question: Question) =>
  Boolean(question.visitedAt) || question.state === 'now' || isExplained(question)

// ---------- Falling in ----------

// A new rabbit hole: one question to begin with, nothing mapped ahead. The words become the first question as
// written (a question mark is added when they read as one); a hole that begins in a book keeps the passage.
export function startHole(words: string, from?: HoleOrigin, now = new Date()): LearningPath | null {
  let text = clip(words, 200)
  if (!text && from?.quote) {
    const quote = clip(from.quote, 70)
    text = `What is behind “${quote}${from.quote.length > 70 ? '…' : ''}”?`
  }
  if (text.length < 2) return null
  if (
    /^(what|why|how|who|when|where|which|is|are|do|does|did|can|could|should|would|will)\b/i.test(text) &&
    !/[?.!]$/.test(text)
  )
    text = `${text}?`
  const stamp = now.toISOString()
  const area: Area = { id: newId('area'), title: clip(text.replace(/\?$/, ''), 60) }
  const first: Question = {
    id: newId('q'),
    areaId: area.id,
    text,
    state: 'later',
    origin: 'start',
    askedAt: stamp,
  }
  // A hole begun from a passage alone is named by the passage; the map shows the passage itself.
  const title =
    !clip(words, 200) && from?.quote
      ? `“${clip(from.quote, 60)}${from.quote.length > 60 ? '…' : ''}”`
      : clip(text.replace(/\?$/, ''), 80)
  return {
    id: `path-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : newId('x')}`,
    title,
    description: '',
    bookIds: from?.kind === 'book' && from.bookId ? [from.bookId] : [],
    createdAt: stamp,
    updated: stamp,
    subject: { areas: [area], questions: [first], from },
  }
}

// The first question of a hole: the one with no question above it that was asked first.
export function firstQuestion(subject: Subject): Question | undefined {
  return [...subject.questions].filter((q) => !q.parentId).sort((a, b) => a.askedAt.localeCompare(b.askedAt))[0]
}

// ---------- On a question ----------

export function markVisited(subject: Subject, id: string, now = new Date()): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question) return subject
  return withQuestion(subject, { ...question, visitedAt: now.toISOString() })
}

export function cleanDoors(raw: unknown): Door[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const doors: Door[] = []
  const take = (kind: DoorKind, value: unknown) => {
    const row = (typeof value === 'string' ? { text: value } : (value ?? {})) as Record<string, unknown>
    const text = clip(row.text ?? row.question, 200)
    if (text.length < 8 || doors.some((door) => same(door.text, text))) return
    doors.push({ kind, text, hook: clip(row.hook, 140) || undefined })
  }
  take('deeper', root.deeper)
  take('side', root.sideways ?? root.side)
  take('curious', root.curiouser ?? root.curious)
  return doors
}

export function withDoors(subject: Subject, id: string, doors: Door[]): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question || !doors?.length) return subject
  return withQuestion(subject, { ...question, doors })
}

// The doors from a question that have not been taken yet (one already asked anywhere in the hole counts as taken).
export function openDoors(subject: Subject, id: string): Door[] {
  const question = subject.questions.find((q) => q.id === id)
  return (question?.doors ?? []).filter((door) => !subject.questions.some((q) => same(q.text, door.text)))
}

// Going through a door: the question is added under the one it came from and returned to open at once. Taking a
// door already taken opens the question that is there. The learner's own question is a door of kind 'own'.
export function takeDoor(
  subject: Subject,
  fromId: string,
  door: { kind: DoorKind | 'own'; text: string; hook?: string },
  now = new Date(),
): { subject: Subject; question: Question | null } {
  const parent = subject.questions.find((q) => q.id === fromId)
  const text = clip(door.text, 200)
  if (!parent || text.length < 2) return { subject, question: null }
  const there = subject.questions.find((q) => same(q.text, text))
  if (there) return { subject, question: there }
  const question: Question = {
    id: newId('q'),
    areaId: parent.areaId,
    text,
    hook: door.hook,
    state: 'later',
    origin: door.kind === 'own' ? 'own' : DOOR_ORIGIN[door.kind],
    parentId: parent.id,
    askedAt: now.toISOString(),
  }
  return { subject: withQuestion(subject, question), question }
}

// ---------- The map ----------

export type MapRow =
  { kind: 'question'; question: Question; depth: number } | { kind: 'door'; door: Door; from: Question; depth: number }
export type MapGroup = { area: Area | null; rows: MapRow[] }

// The hole as an outline: each question followed by the ones it led to, and the open doors of every question
// already visited as faint rows under it. Grouped by area once there is more than one (Map the ground).
export function holeMap(subject: Subject): MapGroup[] {
  const byParent = new Map<string, Question[]>()
  const ids = new Set(subject.questions.map((q) => q.id))
  for (const q of [...subject.questions].sort((a, b) => a.askedAt.localeCompare(b.askedAt))) {
    const key = q.parentId && ids.has(q.parentId) ? q.parentId : ''
    byParent.set(key, [...(byParent.get(key) ?? []), q])
  }
  const seen = new Set<string>()
  // A door offered from two questions shows once, under the first.
  const shownDoors = new Set<string>()
  const walk = (q: Question, depth: number, rows: MapRow[]) => {
    if (seen.has(q.id)) return
    seen.add(q.id)
    rows.push({ kind: 'question', question: q, depth })
    for (const child of byParent.get(q.id) ?? []) walk(child, depth + 1, rows)
    if (!isVisited(q)) return
    for (const door of openDoors(subject, q.id)) {
      const key = door.text.trim().toLowerCase()
      if (shownDoors.has(key)) continue
      shownDoors.add(key)
      rows.push({ kind: 'door', door, from: q, depth: depth + 1 })
    }
  }
  const roots = byParent.get('') ?? []
  const grouped = subject.areas.length > 1
  if (!grouped) {
    const rows: MapRow[] = []
    for (const root of roots) walk(root, 0, rows)
    return [{ area: null, rows }]
  }
  return subject.areas
    .map((area) => {
      const rows: MapRow[] = []
      for (const root of roots.filter((q) => q.areaId === area.id)) walk(root, 0, rows)
      return { area, rows }
    })
    .filter((group) => group.rows.length)
}

export function holeCounts(subject: Subject): { questions: number; visited: number; explained: number } {
  return {
    questions: subject.questions.length,
    visited: subject.questions.filter(isVisited).length,
    explained: subject.questions.filter(isExplained).length,
  }
}

// The question last looked at that is still open: "Back down the rabbit hole".
export function lastOpen(subject: Subject): Question | null {
  return (
    subject.questions
      .filter((q) => !isExplained(q) && q.visitedAt)
      .sort((a, b) => (b.visitedAt ?? '').localeCompare(a.visitedAt ?? ''))[0] ?? null
  )
}

// When the hole was last touched: a visit, an answer, or a climb out.
export function lastActive(subject: Subject): number {
  const times = subject.questions.flatMap((q) => [q.visitedAt, q.answer?.at]).concat(subject.surfacedAt)
  return Math.max(0, ...times.filter((t): t is string => Boolean(t)).map((t) => Date.parse(t)))
}

// ---------- Map the ground ----------

// Noema's outline of the subject joins the hole as groups of questions not yet visited. The questions already
// asked keep their places in a first group named after the hole; nothing is moved or lost.
export function withGround(subject: Subject, draft: SubjectDraft, now = new Date()): Subject {
  const stamp = now.toISOString()
  const areas: Area[] = [...subject.areas]
  const questions = [...subject.questions]
  for (const part of draft.areas) {
    let area = areas.find((item) => same(item.title, part.title))
    if (!area) {
      area = { id: newId('area'), title: clip(part.title, 60), blurb: part.blurb }
      areas.push(area)
    }
    for (const q of part.questions) {
      if (questions.some((item) => same(item.text, q.text))) continue
      questions.push({
        id: newId('q'),
        areaId: area.id,
        text: q.text,
        hook: q.hook,
        state: 'later',
        origin: 'start',
        askedAt: stamp,
      })
    }
  }
  return { ...subject, areas, questions, grounded: true }
}

// ---------- Climbing out ----------

// The questions looked at since the last climb out, in the order they were reached.
export function sinceSurfaced(subject: Subject): Question[] {
  const after = subject.surfacedAt ? Date.parse(subject.surfacedAt) : 0
  return subject.questions
    .filter((q) => q.visitedAt && Date.parse(q.visitedAt) > after)
    .sort((a, b) => (a.visitedAt ?? '').localeCompare(b.visitedAt ?? ''))
}

export function climbOut(subject: Subject, stuck: string, now = new Date()): Subject {
  const text = clip(stuck, 300)
  return {
    ...subject,
    surfacedAt: now.toISOString(),
    stuck: text ? [...(subject.stuck ?? []), { text, at: now.toISOString() }] : subject.stuck,
  }
}

// What recall cards are drafted from: the learner's own words for the questions of this dive (else of the hole).
export function recallPassage(subject: Subject, questions: Question[] = sinceSurfaced(subject)): string {
  const own = (list: Question[]) => list.filter(isExplained).map((q) => `Q: ${q.text}\nA: ${q.answer!.text}`)
  const lines = own(questions).length ? own(questions) : own(subject.questions)
  return lines.join('\n\n').slice(0, 6_000)
}

// ---------- Coming back ----------

export const RECALL_AFTER_DAYS = 2

// Back in a hole after a couple of days, one question explained before (the one recalled longest ago) is asked
// first. Once a visit, and only when there is something explained to recall.
export function recallDue(subject: Subject, now = new Date()): Question | null {
  const last = lastActive(subject)
  if (!last || now.getTime() - last < RECALL_AFTER_DAYS * DAY) return null
  const explained = subject.questions.filter(isExplained)
  if (!explained.length) return null
  return [...explained].sort((a, b) => (a.recalledAt ?? a.answer!.at).localeCompare(b.recalledAt ?? b.answer!.at))[0]
}

export function markRecalled(subject: Subject, id: string, now = new Date()): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question) return subject
  return withQuestion(subject, { ...question, recalledAt: now.toISOString(), visitedAt: now.toISOString() })
}

// ---------- What you found ----------

export type Found = { question: Question; picks: NonNullable<Question['picks']> }

// Everything the learner wrote or kept, in the order the questions were reached.
export function foundIn(subject: Subject): Found[] {
  return subject.questions
    .filter((q) => q.guess || q.answer || (q.picks ?? []).some((pick) => pick.saved))
    .sort((a, b) => (a.visitedAt ?? a.askedAt).localeCompare(b.visitedAt ?? b.askedAt))
    .map((question) => ({ question, picks: (question.picks ?? []).filter((pick) => pick.saved) }))
}

export function sumItUp(subject: Subject, text: string, now = new Date()): Subject {
  const words = clip(text, 1_500)
  return { ...subject, summary: words ? { text: words, at: now.toISOString() } : undefined }
}

export function holeMarkdown(path: LearningPath, subject: Subject): string {
  const out: string[] = [`# ${path.title}`, '']
  if (subject.from?.quote) out.push(`> ${subject.from.quote}`, `> (${subject.from.title})`, '')
  if (subject.summary) out.push('## In my words', '', subject.summary.text, '')
  if (subject.stuck?.length) out.push('## What stuck', '', ...subject.stuck.map((line) => `- ${line.text}`), '')
  out.push('## The trail', '')
  for (const { question, picks } of foundIn(subject)) {
    out.push(`### ${question.text}`, '')
    if (question.guess) out.push(`*My guess:* ${question.guess}`, '')
    if (question.answer) out.push(question.answer.text, '')
    for (const pick of picks)
      out.push(`- ${pick.url ? `[${pick.title}](${pick.url})` : pick.title}${pick.source ? `, ${pick.source}` : ''}`)
    if (picks.length) out.push('')
  }
  return out.join('\n').trim() + '\n'
}

// ---------- Connections ----------

const STOP = new Set(
  'the a an of and or to in on for with what why how who when where which is are was were do does did can could should would will it its this that these those from by about into than then there their them they you your my me we our as at be been being not no yes'.split(
    ' ',
  ),
)
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP.has(word))
      .map((word) => word.replace(/(ies|es|s)$/, '')),
  )

// Other rabbit holes with a question that shares at least two meaningful words with this one.
export function connectedHoles(
  paths: LearningPath[],
  pathId: string,
  question: Question,
  subjectOf: (path: LearningPath) => Subject,
): Array<{ path: LearningPath; question: Question }> {
  const mine = words(question.text)
  if (mine.size < 2) return []
  const found: Array<{ path: LearningPath; question: Question }> = []
  for (const path of paths) {
    if (path.id === pathId) continue
    const match = subjectOf(path).questions.find((q) => {
      let shared = 0
      for (const word of words(q.text)) if (mine.has(word)) shared += 1
      return shared >= 2
    })
    if (match) found.push({ path, question: match })
  }
  return found.slice(0, 3)
}

// A question removed from the map takes nothing with it: the ones under it move up (removeQuestion).
export { removeQuestion }
