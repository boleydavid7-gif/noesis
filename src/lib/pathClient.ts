import { authHeaders } from './auth'
import { noemaUsed } from './plus'
import type { SubjectDraft } from './subjects'
import { unverifiedBook, type BookCandidate, type ResolvedBook } from './pathPlan'

const CACHE_KEY = 'noesis:book-cache:v1'
const FOUND_DAYS = 30
const MISSING_DAYS = 7
const DAY = 86_400_000

type CacheEntry = { at: number; book: ResolvedBook | null }

function readCache(): Record<string, CacheEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, CacheEntry>) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, CacheEntry>) {
  try {
    // Keep it small: the newest 150 lookups are plenty.
    const entries = Object.entries(cache)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 150)
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // The cache is only an optimisation.
  }
}

export const bookKey = (candidate: BookCandidate) => `${candidate.title}|${candidate.author}`.toLowerCase()

export class AuthRequiredError extends Error {}

export type Focus = { title: string; description: string; covers?: string[]; fits?: string }
export type Clarification = { topic: string; broad: boolean; focuses: Focus[] }

async function post<T>(route: string, body: unknown, fallback: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach Noesis. Check your connection and try again.')
  }
  noemaUsed()
  const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T
  if (response.status === 401) throw new AuthRequiredError(result.error || 'Sign in to use this.')
  if (!response.ok || !result.ok) throw new Error(result.error || fallback)
  return result
}

export async function requestClarification(goal: string): Promise<Clarification> {
  return post<Clarification>('/api/clarify', { goal }, 'Noema could not narrow that down right now. Try again.')
}

// null means "no such book was found" (so it is left out); a catalog outage
// keeps the suggestion but marks it unverified.
export async function resolveBook(candidate: BookCandidate, now = Date.now()): Promise<ResolvedBook | null> {
  const key = bookKey(candidate)
  const cache = readCache()
  const cached = cache[key]
  if (cached && now - cached.at < (cached.book ? FOUND_DAYS : MISSING_DAYS) * DAY) return cached.book
  try {
    const params = new URLSearchParams({ title: candidate.title, author: candidate.author })
    if (candidate.note) params.set('note', candidate.note)
    const response = await fetch(`/api/book?${params.toString()}`)
    if (!response.ok) return unverifiedBook(candidate)
    const body = (await response.json()) as { ok?: boolean; book?: ResolvedBook | null }
    if (!body.ok) return unverifiedBook(candidate)
    cache[key] = { at: now, book: body.book ?? null }
    writeCache(cache)
    return body.book ?? null
  } catch {
    return unverifiedBook(candidate)
  }
}

// Looks books up a few at a time, reporting the list so far (in the AI's order)
// as each one arrives so the page can fill in progressively.
export async function resolveBooks(
  candidates: BookCandidate[],
  onProgress?: (books: ResolvedBook[], done: number, total: number) => void,
  concurrency = 4,
): Promise<ResolvedBook[]> {
  const results: Array<ResolvedBook | null | undefined> = new Array(candidates.length).fill(undefined)
  let next = 0
  let finished = 0
  const report = () => {
    finished += 1
    onProgress?.(
      results.filter((book): book is ResolvedBook => Boolean(book)),
      finished,
      candidates.length,
    )
  }
  const worker = async () => {
    while (next < candidates.length) {
      const index = next
      next += 1
      results[index] = await resolveBook(candidates[index])
      report()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker))
  return results.filter((book): book is ResolvedBook => Boolean(book))
}

// ---------- Subjects ----------

export async function requestSubject(input: { goal: string; focus?: string; level?: string }): Promise<SubjectDraft> {
  const result = await post<{ draft?: SubjectDraft }>(
    '/api/subject',
    input,
    'Noema could not map that subject right now. Try again in a moment.',
  )
  if (!result.draft) throw new Error('Noema could not map that subject right now. Try again in a moment.')
  return result.draft
}

export type ExploredPick = {
  type: 'read' | 'watch' | 'listen' | 'try'
  title: string
  source: string
  url?: string
  minutes?: number
  why?: string
  thumb?: string
}
export type Explored = {
  hook?: string
  short?: string
  followUp?: string
  useIt?: string
  books: BookCandidate[]
  picks: ExploredPick[]
}

export async function exploreQuestion(input: {
  subject: string
  area?: string
  question: string
  level?: string
  reading?: string[]
  part?: 'answer' | 'picks'
}): Promise<Explored> {
  const result = await post<Partial<Explored>>(
    '/api/question',
    input,
    'Noema could not find things to explore right now. Try again in a moment.',
  )
  return {
    hook: result.hook,
    short: result.short,
    followUp: result.followUp,
    useIt: result.useIt,
    books: result.books ?? [],
    picks: result.picks ?? [],
  }
}

// Rabbit holes: three questions one level further down.
export async function requestDeeper(input: {
  subject: string
  area?: string
  question: string
  level?: string
  trail: string[]
}): Promise<string[]> {
  const result = await post<{ deeper?: unknown }>(
    '/api/question',
    { ...input, part: 'deeper' },
    'Noema could not go deeper right now. Try again in a moment.',
  )
  return Array.isArray(result.deeper) ? result.deeper.filter((item): item is string => typeof item === 'string') : []
}

export async function requestSumUp(input: {
  subject: string
  area: string
  answers: Array<{ question: string; answer: string }>
  questions: string[]
}): Promise<{ text: string; merges: unknown[] }> {
  const result = await post<{ text?: string; merges?: unknown[] }>(
    '/api/sumup',
    input,
    'Noema could not draft a summary right now.',
  )
  return { text: result.text ?? '', merges: Array.isArray(result.merges) ? result.merges : [] }
}
