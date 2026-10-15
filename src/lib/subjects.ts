// A subject is a map of questions around the learner's reading, not a course. Areas (four to seven) hold the questions; a question is
// Now (at most three at a time), Later, or Answered in the learner's own words. Each question carries a few
// picks to read, watch, listen to, or try, grouped by kind. Everything here is pure, so it is tested alone.

import type { LearningPath, PathPlan, ResolvedBook } from './pathPlan'
import { isPublicHttps } from './pathPlan'

export type PickType = 'read' | 'watch' | 'listen' | 'book' | 'try'
// Books lead: Noesis is a reader first, and the rest is there to go with the reading.
export const PICK_GROUPS: Array<{ type: PickType; label: string }> = [
  { type: 'book', label: 'Books' },
  { type: 'read', label: 'Read' },
  { type: 'watch', label: 'Watch' },
  { type: 'listen', label: 'Listen' },
  { type: 'try', label: 'Try it' },
]

export type Pick = {
  id: string
  type: PickType
  title: string
  source: string // site, channel, show, or author
  url?: string
  minutes?: number
  why?: string
  thumb?: string
  book?: ResolvedBook
  saved?: boolean
  looked?: boolean
}

export type QuestionState = 'now' | 'later' | 'answered'
export type Answer = { text: string; pickIds: string[]; at: string }
export type Question = {
  id: string
  areaId: string
  text: string
  hook?: string // why it is interesting, one line
  state: QuestionState
  origin: 'start' | 'side' | 'own' | 'deeper'
  parentId?: string // the question this one went deeper from
  guess?: string
  short?: string // Noema's short answer, folded until opened
  followUp?: string // a question the answer leads to, offered when it comes back
  picks?: Pick[]
  answer?: Answer
  askedAt: string
  cameBackAt?: string
  useIt?: UseIt // one small thing to do with it, for practical subjects
}
export type UseIt = { text: string; doneAt?: string }
export type Area = { id: string; title: string; blurb?: string; summary?: { text: string; at: string } }
export type Subject = {
  why?: string
  level?: string
  areas: Area[]
  questions: Question[]
}

export const NOW_LIMIT = 3
export const SUM_UP_AFTER = 5
export const COME_BACK_DAYS = 14

const DAY = 86_400_000
const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
export const newId = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 13) : Math.random().toString(36).slice(2, 12)}`

// ---------- Reading the map ----------

export type AreaState = 'new' | 'exploring' | 'summed'
export function areaState(subject: Subject, areaId: string): AreaState {
  const area = subject.areas.find((item) => item.id === areaId)
  if (area?.summary) return 'summed'
  return subject.questions.some((q) => q.areaId === areaId && q.state !== 'later') ? 'exploring' : 'new'
}

export function questionsIn(subject: Subject, areaId: string, state?: QuestionState): Question[] {
  return subject.questions.filter((q) => q.areaId === areaId && (!state || q.state === state))
}

export const nowQuestions = (subject: Subject) => subject.questions.filter((q) => q.state === 'now')

// Answered since the area was last summed up; five or more offers "Sum up this area".
export function canSumUp(subject: Subject, areaId: string): boolean {
  const area = subject.areas.find((item) => item.id === areaId)
  if (!area) return false
  const since = area.summary?.at ?? ''
  return questionsIn(subject, areaId, 'answered').filter((q) => (q.answer?.at ?? '') > since).length >= SUM_UP_AFTER
}

// One answered question from two weeks or more ago comes back, the oldest first, at most once a fortnight each.
export function comingBack(subject: Subject, now = new Date()): Question | null {
  const cutoff = now.getTime() - COME_BACK_DAYS * DAY
  const ready = subject.questions.filter((q) => {
    if (q.state !== 'answered' || !q.answer) return false
    const last = Date.parse(q.cameBackAt ?? q.answer.at)
    return Number.isFinite(last) && last <= cutoff
  })
  ready.sort((a, b) => (a.cameBackAt ?? a.answer!.at).localeCompare(b.cameBackAt ?? b.answer!.at))
  return ready[0] ?? null
}

export function subjectCounts(subject: Subject): { areas: number; answered: number; now: number } {
  return {
    areas: subject.areas.length,
    answered: subject.questions.filter((q) => q.state === 'answered').length,
    now: nowQuestions(subject).length,
  }
}

// ---------- Changing it ----------

export type Moved = { subject: Subject; full: boolean }

export function moveQuestion(subject: Subject, id: string, state: Exclude<QuestionState, 'answered'>): Moved {
  const question = subject.questions.find((q) => q.id === id)
  if (!question || question.state === state) return { subject, full: false }
  if (state === 'now' && nowQuestions(subject).length >= NOW_LIMIT) return { subject, full: true }
  return { subject: withQuestion(subject, { ...question, state }), full: false }
}

export function withQuestion(subject: Subject, question: Question): Subject {
  const exists = subject.questions.some((q) => q.id === question.id)
  return {
    ...subject,
    questions: exists
      ? subject.questions.map((q) => (q.id === question.id ? question : q))
      : [...subject.questions, question],
  }
}

export function answerQuestion(subject: Subject, id: string, text: string, pickIds: string[], now = new Date()) {
  const question = subject.questions.find((q) => q.id === id)
  const words = text.trim().slice(0, 600)
  if (!question || !words) return subject
  return withQuestion(subject, {
    ...question,
    state: 'answered',
    answer: { text: words, pickIds, at: now.toISOString() },
  })
}

// Opening an answer again keeps the words for editing; the question goes back to Now when there is room.
export function reopenQuestion(subject: Subject, id: string): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question) return subject
  const room = nowQuestions(subject).length < NOW_LIMIT
  return withQuestion(subject, { ...question, state: room ? 'now' : 'later' })
}

export function addQuestion(
  subject: Subject,
  areaId: string,
  text: string,
  origin: Question['origin'] = 'own',
  now = new Date(),
  parentId?: string,
): { subject: Subject; question: Question | null } {
  const words = clip(text, 200)
  if (!words || !subject.areas.some((area) => area.id === areaId)) return { subject, question: null }
  const same = subject.questions.find((q) => q.text.toLowerCase() === words.toLowerCase())
  if (same) return { subject, question: same }
  const question: Question = {
    id: newId('q'),
    areaId,
    text: words,
    state: 'later',
    origin,
    askedAt: now.toISOString(),
    ...(parentId ? { parentId } : {}),
  }
  return { subject: withQuestion(subject, question), question }
}

// ---------- Rabbit holes: going deeper from a question ----------

export const DEEPER_LIMIT = 3

// The questions above this one, the first asked first; a broken or looping chain stops where it breaks.
export function trailOf(subject: Subject, id: string): Question[] {
  const byId = new Map(subject.questions.map((q) => [q.id, q]))
  const trail: Question[] = []
  const seen = new Set([id])
  let parentId = byId.get(id)?.parentId
  while (parentId && !seen.has(parentId) && byId.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)!
    trail.unshift(parent)
    parentId = parent.parentId
  }
  return trail
}

export const deeperFrom = (subject: Subject, id: string): Question[] =>
  subject.questions.filter((q) => q.parentId === id)

// How far down a question sits: 0 for one asked at the top.
export const depthOf = (subject: Subject, id: string) => trailOf(subject, id).length

// The questions Noema offers one level down, added under the question in Later; ones already there are left out.
export function goDeeper(subject: Subject, id: string, texts: string[], now = new Date()): Subject {
  const parent = subject.questions.find((q) => q.id === id)
  if (!parent) return subject
  let next = subject
  for (const text of texts.slice(0, DEEPER_LIMIT)) {
    const words = clip(text, 200)
    if (!words || next.questions.some((q) => q.text.toLowerCase() === words.toLowerCase())) continue
    next = addQuestion(next, parent.areaId, words, 'deeper', now, parent.id).subject
  }
  return next
}

// A list with each question followed by the ones under it, and how many levels in it sits within the list.
export function inTreeOrder(list: Question[]): Array<{ question: Question; depth: number }> {
  const ids = new Set(list.map((q) => q.id))
  const out: Array<{ question: Question; depth: number }> = []
  const seen = new Set<string>()
  const visit = (question: Question, depth: number) => {
    if (seen.has(question.id)) return
    seen.add(question.id)
    out.push({ question, depth })
    for (const child of list) if (child.parentId === question.id) visit(child, depth + 1)
  }
  for (const q of list) if (!q.parentId || !ids.has(q.parentId)) visit(q, 0)
  for (const q of list) visit(q, 0) // anything left in a loop
  return out
}

// The question furthest down that is still open, for "Back down the rabbit hole" on Home.
export function deepestOpen(subject: Subject): Question | null {
  const open = subject.questions.filter((q) => q.state !== 'answered' && q.parentId)
  if (!open.length) return null
  return open
    .map((q) => ({ q, depth: depthOf(subject, q.id) }))
    .sort((a, b) => b.depth - a.depth || b.q.askedAt.localeCompare(a.q.askedAt))[0].q
}

export function cleanDeeperReply(raw: unknown): string[] {
  const list = raw && typeof raw === 'object' ? (raw as { deeper?: unknown }).deeper : undefined
  return (Array.isArray(list) ? list : [])
    .map((item) => clip(item, 200))
    .filter((text) => text.length >= 8)
    .slice(0, DEEPER_LIMIT)
}

// The questions under a removed one move up a level, so nothing further down is lost.
export function removeQuestion(subject: Subject, id: string): Subject {
  const gone = subject.questions.find((q) => q.id === id)
  return {
    ...subject,
    questions: subject.questions
      .filter((q) => q.id !== id)
      .map((q) => (q.parentId === id ? { ...q, parentId: gone?.parentId } : q)),
  }
}

export function addArea(subject: Subject, title: string): { subject: Subject; area: Area | null } {
  const name = clip(title, 60)
  if (!name) return { subject, area: null }
  const area: Area = { id: newId('area'), title: name }
  return { subject: { ...subject, areas: [...subject.areas, area] }, area }
}

export function renameArea(subject: Subject, id: string, title: string): Subject {
  const name = clip(title, 60)
  if (!name) return subject
  return { ...subject, areas: subject.areas.map((area) => (area.id === id ? { ...area, title: name } : area)) }
}

// Removing an area moves its questions to the first other area, so nothing written is lost.
export function removeArea(subject: Subject, id: string): Subject {
  const rest = subject.areas.filter((area) => area.id !== id)
  if (rest.length === subject.areas.length || rest.length === 0) return subject
  return {
    ...subject,
    areas: rest,
    questions: subject.questions.map((q) => (q.areaId === id ? { ...q, areaId: rest[0].id } : q)),
  }
}

export function sumUpArea(subject: Subject, id: string, text: string, now = new Date()): Subject {
  const words = text.trim().slice(0, 1_200)
  return {
    ...subject,
    areas: subject.areas.map((area) =>
      area.id === id ? { ...area, summary: words ? { text: words, at: now.toISOString() } : undefined } : area,
    ),
  }
}

export function markCameBack(subject: Subject, id: string, now = new Date()): Subject {
  const question = subject.questions.find((q) => q.id === id)
  return question ? withQuestion(subject, { ...question, cameBackAt: now.toISOString() }) : subject
}

export function updatePick(subject: Subject, questionId: string, pickId: string, change: Partial<Pick>): Subject {
  const question = subject.questions.find((q) => q.id === questionId)
  if (!question?.picks) return subject
  return withQuestion(subject, {
    ...question,
    picks: question.picks.map((pick) => (pick.id === pickId ? { ...pick, ...change } : pick)),
  })
}

// ---------- Picks ----------

export function groupPicks(picks: Pick[]): Array<{ type: PickType; label: string; picks: Pick[] }> {
  return PICK_GROUPS.map((group) => ({ ...group, picks: picks.filter((pick) => pick.type === group.type) })).filter(
    (group) => group.picks.length > 0,
  )
}

// Everything saved in a subject, by kind, with the question it belongs to.
export function shelf(
  subject: Subject,
): Array<{ type: PickType; label: string; items: Array<{ pick: Pick; question: Question }> }> {
  const saved = subject.questions.flatMap((question) =>
    (question.picks ?? []).filter((pick) => pick.saved).map((pick) => ({ pick, question })),
  )
  return PICK_GROUPS.map((group) => ({
    ...group,
    items: saved.filter((item) => item.pick.type === group.type),
  })).filter((group) => group.items.length > 0)
}

export function minutesText(pick: Pick): string {
  if (!pick.minutes) return ''
  const time =
    pick.minutes >= 60
      ? `${Math.floor(pick.minutes / 60)} h ${pick.minutes % 60 ? `${pick.minutes % 60} min` : ''}`.trim()
      : `${pick.minutes} min`
  return pick.type === 'read' ? `${time} read` : time
}

export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null
    if (host !== 'youtube.com') return null
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v')
    const match = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

// ISO 8601 durations from YouTube ("PT1H2M30S") to whole minutes.
export function isoMinutes(value: string): number | undefined {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value)
  if (!match) return undefined
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0))
  const total = d * 1440 + h * 60 + m + s / 60
  return total > 0 ? Math.max(1, Math.round(total)) : undefined
}

function minutesOf(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(number) && number > 0 ? Math.min(600, Math.max(1, Math.round(number))) : undefined
}

// What the model proposes for one question, before links are checked.
export type PickDraft = {
  type: PickType
  title: string
  source: string
  url?: string
  minutes?: number
  why?: string
  search?: string // words to look a video or episode up by, when no exact link is known
  author?: string
}
export type QuestionDraft = { hook?: string; short?: string; followUp?: string; useIt?: string; picks: PickDraft[] }

export function cleanQuestionReply(raw: unknown): QuestionDraft {
  const root = (raw ?? {}) as Record<string, unknown>
  const list = (key: string) => (Array.isArray(root[key]) ? (root[key] as unknown[]) : []).slice(0, 4)
  const picks: PickDraft[] = []
  const add = (type: PickType, item: unknown) => {
    const row = (item ?? {}) as Record<string, unknown>
    const title = clip(row.title ?? row.search, 140)
    if (!title) return
    const url = clip(row.url, 400)
    picks.push({
      type,
      title,
      source: clip(row.source ?? row.channel ?? row.show ?? row.publisher, 80),
      url: url && isPublicHttps(url) ? url : undefined,
      minutes: minutesOf(row.minutes),
      why: clip(row.why, 140) || undefined,
      search: clip(row.search, 120) || undefined,
      author: clip(row.author, 100) || undefined,
    })
  }
  list('books').forEach((item) => add('book', item))
  list('read').forEach((item) => add('read', item))
  list('watch').forEach((item) => add('watch', item))
  list('listen').forEach((item) => add('listen', item))
  list('try').forEach((item) => add('try', item))
  return {
    hook: clip(root.hook, 200) || undefined,
    short: typeof root.short === 'string' ? root.short.trim().slice(0, 1_200) || undefined : undefined,
    followUp: clip(root.followUp, 200) || undefined,
    useIt: clip(root.useIt, 160) || undefined,
    picks,
  }
}

// The model's map for a new subject: areas in a sensible order, each with a few questions.
export type SubjectDraft = {
  title: string
  summary: string
  areas: Array<{ title: string; blurb?: string; questions: Array<{ text: string; hook?: string }> }>
}

export function cleanSubjectReply(raw: unknown): SubjectDraft | null {
  const root = (raw ?? {}) as Record<string, unknown>
  const areas = (Array.isArray(root.areas) ? root.areas : []).slice(0, 7).flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    const title = clip(row.title, 60)
    const questions = (Array.isArray(row.questions) ? row.questions : []).slice(0, 6).flatMap((entry) => {
      const q = (typeof entry === 'string' ? { text: entry } : (entry ?? {})) as Record<string, unknown>
      const text = clip(q.text ?? q.question, 200)
      return text ? [{ text, hook: clip(q.hook, 200) || undefined }] : []
    })
    return title && questions.length ? [{ title, blurb: clip(row.blurb, 160) || undefined, questions }] : []
  })
  if (areas.length < 2) return null
  return { title: clip(root.title, 80), summary: clip(root.summary, 240), areas }
}

// The first question of each of the first three areas starts in Now, so the start has some variety.
export function subjectFromDraft(
  draft: SubjectDraft,
  extra: { why?: string; level?: string } = {},
  now = new Date(),
): Subject {
  const stamp = now.toISOString()
  const areas: Area[] = draft.areas.map((area) => ({ id: newId('area'), title: area.title, blurb: area.blurb }))
  const questions: Question[] = draft.areas.flatMap((area, a) =>
    area.questions.map((q, i) => ({
      id: newId('q'),
      areaId: areas[a].id,
      text: q.text,
      hook: q.hook,
      state: i === 0 && a < NOW_LIMIT ? ('now' as const) : ('later' as const),
      origin: 'start' as const,
      askedAt: stamp,
    })),
  )
  return { areas, questions, why: extra.why, level: extra.level }
}

export function pathFromSubject(
  draft: SubjectDraft,
  goal: string,
  extra: { why?: string; level?: string } = {},
  now = new Date(),
): LearningPath {
  const stamp = now.toISOString()
  return {
    id: `path-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : newId('x')}`,
    title: draft.title || goal.slice(0, 80),
    description: draft.summary || goal,
    bookIds: [],
    createdAt: stamp,
    updated: stamp,
    subject: subjectFromDraft(draft, extra, now),
  }
}

export function emptySubject(): Subject {
  return { areas: [{ id: newId('area'), title: 'Getting started' }], questions: [] }
}

// ---------- Older paths ----------

// A path planned before subjects existed: stages become areas, topics become questions (ticked ones answered,
// with a note that they came from the old plan), and the plan's books and links become picks on each area's
// first question. The plan itself stays on the record, so nothing is lost.
export function subjectFromPlan(plan: PathPlan, now = new Date()): Subject {
  const stamp = now.toISOString()
  const areas: Area[] = plan.milestones.map((milestone) => ({
    id: `area-${milestone.id}`,
    title: milestone.title,
    blurb: milestone.outcome,
  }))
  let nowCount = 0
  const questions: Question[] = plan.milestones.flatMap((milestone, m) =>
    milestone.topics.map((topic, t) => {
      const state: QuestionState = topic.done ? 'answered' : nowCount < NOW_LIMIT && !milestone.moved ? 'now' : 'later'
      if (state === 'now') nowCount += 1
      const picks: Pick[] = []
      if (t === 0) {
        for (const title of milestone.resourceTitles ?? []) {
          const resource = plan.resources.find((item) => item.title === title)
          if (resource)
            picks.push({
              id: `pick-${milestone.id}-${picks.length}`,
              type: /video/i.test(resource.kind) ? 'watch' : /lab|hands/i.test(resource.kind) ? 'try' : 'read',
              title: resource.title,
              source: resource.publisher,
              url: resource.url,
              why: resource.note,
            })
        }
        for (const title of milestone.bookTitles ?? []) {
          const book = plan.books.find((item) => item.title === title)
          if (book)
            picks.push({
              id: `pick-${milestone.id}-${picks.length}`,
              type: 'book',
              title: book.title,
              source: book.authors.join(', '),
              url: book.infoUrl,
              thumb: book.coverUrl,
              why: book.note,
              book,
            })
        }
      }
      return {
        id: `q-${topic.id}`,
        areaId: areas[m].id,
        text: topic.label,
        state,
        origin: 'start' as const,
        picks: picks.length ? picks : undefined,
        answer: topic.done ? { text: 'Marked done in the earlier plan.', pickIds: [], at: stamp } : undefined,
        askedAt: stamp,
      }
    }),
  )
  return { areas, questions, level: plan.level }
}

// Every path has a subject: its own, one made from an older plan, or an empty one for a plain book collection.
export function subjectOf(path: LearningPath): Subject {
  if (path.subject) return path.subject
  if (path.plan) return subjectFromPlan(path.plan)
  return { areas: [{ id: `area-${path.id}`, title: 'Getting started' }], questions: [] }
}

// ---------- While reading ----------

const titleKey = (value: string) =>
  value
    .toLowerCase()
    .split(':')[0]
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// The subject a book belongs to, and the questions to keep in mind while reading it: questions that suggested
// this book first, then the subject's Now questions.
export function subjectFor(
  book: { id: string; title: string },
  paths: LearningPath[],
): { path: LearningPath; questions: Question[] } | null {
  const wanted = titleKey(book.title)
  for (const path of paths) {
    const subject = subjectOf(path)
    if (!subject) continue
    const named = subject.questions.filter((q) =>
      (q.picks ?? []).some((pick) => pick.type === 'book' && titleKey(pick.title) === wanted),
    )
    if (!named.length && !path.bookIds.includes(book.id)) continue
    const now = nowQuestions(subject).filter((q) => !named.includes(q))
    return { path, questions: [...named, ...now].slice(0, 5) }
  }
  return null
}

// Books suggested for the questions in Now, across subjects, for Home's shelf.
export function booksForNow(paths: LearningPath[]): Array<{ path: LearningPath; question: Question; pick: Pick }> {
  const seen = new Set<string>()
  return paths.flatMap((path) => {
    const subject = subjectOf(path)
    if (!subject) return []
    return nowQuestions(subject).flatMap((question) =>
      (question.picks ?? [])
        .filter((pick) => pick.type === 'book')
        .filter((pick) => !seen.has(titleKey(pick.title)) && Boolean(seen.add(titleKey(pick.title))))
        .map((pick) => ({ path, question, pick })),
    )
  })
}

// ---------- Use it ----------

export function markUsed(subject: Subject, id: string, done: boolean, now = new Date()): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question?.useIt) return subject
  return withQuestion(subject, {
    ...question,
    useIt: { text: question.useIt.text, doneAt: done ? now.toISOString() : undefined },
  })
}

// ---------- Two questions that ask the same thing ----------

export type MergeOffer = { keep: string; drop: string; text: string }

// The model names pairs by their place in the list it was sent; only real, distinct pairs in this area are kept.
export function cleanMerges(raw: unknown, ids: string[], limit = 3): MergeOffer[] {
  const used = new Set<string>()
  return (Array.isArray(raw) ? raw : [])
    .flatMap((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      const a = ids[Number(row.a) - 1]
      const b = ids[Number(row.b) - 1]
      const text = clip(row.text, 200)
      if (!a || !b || a === b || !text || used.has(a) || used.has(b)) return []
      used.add(a)
      used.add(b)
      return [{ keep: a, drop: b, text }]
    })
    .slice(0, limit)
}

// Two questions become one: the wording given, every pick from both, both answers kept (joined), the further
// state of the two (answered, then now, then later), and nothing written is lost.
export function mergeQuestions(subject: Subject, keepId: string, dropId: string, text: string): Subject {
  const keep = subject.questions.find((q) => q.id === keepId)
  const drop = subject.questions.find((q) => q.id === dropId)
  const words = clip(text, 200)
  if (!keep || !drop || keep.id === drop.id || !words) return subject
  const rank: Record<QuestionState, number> = { answered: 2, now: 1, later: 0 }
  const state = rank[drop.state] > rank[keep.state] ? drop.state : keep.state
  const seen = new Set((keep.picks ?? []).map((pick) => (pick.url ?? pick.title).toLowerCase()))
  const picks = [
    ...(keep.picks ?? []),
    ...(drop.picks ?? []).filter((pick) => !seen.has((pick.url ?? pick.title).toLowerCase())),
  ]
  const answers = [keep.answer, drop.answer].filter((answer): answer is Answer => Boolean(answer))
  const answer: Answer | undefined = answers.length
    ? {
        text: answers
          .map((item) => item.text)
          .join(' ')
          .slice(0, 600),
        pickIds: [...new Set(answers.flatMap((item) => item.pickIds))],
        at: answers
          .map((item) => item.at)
          .sort()
          .at(-1)!,
      }
    : undefined
  const merged: Question = {
    ...keep,
    text: words,
    state: state === 'answered' && !answer ? 'now' : state,
    picks: picks.length ? picks : undefined,
    answer,
    guess: keep.guess ?? drop.guess,
    useIt: keep.useIt ?? drop.useIt,
    followUp: keep.followUp ?? drop.followUp,
  }
  return withQuestion(removeQuestion(subject, dropId), merged)
}

// ---------- How much Noesis leads ----------

// Early on Noesis leads: it offers the next question and looks for things to explore as soon as a question opens.
// As the reader answers more, it steps back: after a few answers it offers a next question only when Now is
// empty, and once the reader is well into the subject it waits to be asked.
export type Guidance = {
  stage: 'starting' | 'going' | 'own'
  nextUp: Question | null
  autoExplore: boolean
  tip: boolean
}
export const GOING_AFTER = 3
export const OWN_AFTER = 12

export function guidance(subject: Subject): Guidance {
  const answered = subject.questions.filter((q) => q.state === 'answered').length
  const stage = answered >= OWN_AFTER ? 'own' : answered >= GOING_AFTER ? 'going' : 'starting'
  const now = nowQuestions(subject).length
  const wantsNext = stage === 'starting' ? now < NOW_LIMIT : stage === 'going' ? now === 0 : false
  let nextUp: Question | null = null
  if (wantsNext) {
    for (const area of subject.areas) {
      nextUp = subject.questions.find((q) => q.areaId === area.id && q.state === 'later') ?? null
      if (nextUp) break
    }
  }
  return { stage, nextUp, autoExplore: stage !== 'own', tip: stage === 'starting' && answered === 0 }
}

// ---------- Filling a question in, a part at a time ----------

export type FoundAnswer = { hook?: string; short?: string; followUp?: string; useIt?: string }

export function withAnswerPart(subject: Subject, id: string, found: FoundAnswer): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question) return subject
  return withQuestion(subject, {
    ...question,
    hook: question.hook ?? found.hook,
    short: found.short ?? question.short,
    followUp: found.followUp ?? question.followUp,
    useIt: question.useIt ?? (found.useIt ? { text: found.useIt } : undefined),
  })
}

// Adds picks to a question, leaving out any already there. "fresh" starts over, keeping only saved picks.
export function withPicks(subject: Subject, id: string, found: Array<Omit<Pick, 'id'>>, fresh = false): Subject {
  const question = subject.questions.find((q) => q.id === id)
  if (!question) return subject
  const kept = (question.picks ?? []).filter((pick) => !fresh || pick.saved)
  const key = (pick: { url?: string; title: string }) => (pick.url ?? pick.title).toLowerCase()
  const seen = new Set(kept.map(key))
  const added = found
    .filter((pick) => !seen.has(key(pick)) && Boolean(seen.add(key(pick))))
    .map((pick) => ({ ...pick, id: newId('pick') }))
  return withQuestion(subject, { ...question, picks: [...kept, ...added] })
}
