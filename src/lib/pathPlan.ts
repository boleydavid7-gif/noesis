// AI-generated learning paths. The model only designs the structure (paths,
// milestones, topics) and names books and free resources; the app then looks
// up the real books and checks the links, and drops anything it cannot find.

export type PlanTopic = { id: string; label: string; done: boolean }
export type PlanMilestone = {
  id: string
  title: string
  topics: PlanTopic[]
  timeframe?: string // e.g. "Week 1" or "Weeks 2–3"
  outcome?: string // what the learner can do once the stage is finished
  resourceTitles?: string[] // titles from the plan's resource list to study with
  bookTitles?: string[] // titles from the plan's book list to study with
  hours?: number // estimated study hours for the whole stage
}

export type PlanResource = { title: string; publisher: string; url: string; kind: string; note?: string }

export type BookLinks = { store: string; url: string; note?: string }
export type RatingSource = { source: string; average: number; count: number }
export type ResolvedBook = {
  title: string
  authors: string[]
  year?: number
  isbn?: string
  coverUrl?: string
  rating?: number
  ratingsCount?: number
  ratings?: RatingSource[] // where the combined rating came from
  price?: string
  note?: string // the AI's reason for suggesting it, e.g. "Best overview"
  description?: string
  buy: BookLinks[]
  freeUrl?: string
  infoUrl?: string
  unverified?: boolean // the lookup service was unavailable, so this is only the AI's suggestion
}

export type SuggestedPath = {
  id: string
  title: string
  summary: string
  weeks: string
  level: string
  milestones: PlanMilestone[]
  books: BookCandidate[] // this path's own reading list
}
export type BookCandidate = { title: string; author: string; note?: string }
export type Suggestion = {
  goal: string
  paths: SuggestedPath[]
  books: BookCandidate[]
  resources: PlanResource[]
}

// What is stored on a saved learning path.
export type PathPlan = {
  goal: string
  summary: string
  weeks: string
  level: string
  milestones: PlanMilestone[]
  hoursPerWeek?: number
  books: ResolvedBook[]
  resources: PlanResource[]
}

export type LearningPath = {
  id: string
  title: string
  description: string
  bookIds: string[]
  createdAt: string
  updated?: string
  plan?: PathPlan
}

export const BOOK_NOTES = [
  'Best overview',
  'Beginner friendly',
  'For certification',
  'Practical skills',
  'Deep dive',
  'Classic',
  'Reference',
]
export const RESOURCE_KINDS = [
  'Free course',
  'Official resource',
  'Video series',
  'Hands-on labs',
  'Documentation',
  'Article series',
]

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

function isPublicHttps(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false
    return host.includes('.')
  } catch {
    return false
  }
}

export const MAX_PATHS = 6

function hoursOf(value: unknown): number | undefined {
  const hours = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(hours) && hours > 0 ? Math.min(80, Math.max(2, Math.round(hours))) : undefined
}

export function cleanResources(value: unknown, limit = 10): PlanResource[] {
  return (Array.isArray(value) ? value : []).slice(0, limit).flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    const url = clip(row.url, 300)
    const title = clip(row.title, 100)
    if (!title || !isPublicHttps(url)) return []
    return [
      {
        title,
        publisher: clip(row.publisher, 60),
        url,
        kind: clip(row.kind, 24) || 'Free resource',
        note: clip(row.note, 120) || undefined,
      },
    ]
  })
}

export function cleanBooks(value: unknown, limit = 12): BookCandidate[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : [])
    .slice(0, limit * 2)
    .flatMap((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      const title = clip(row.title, 140)
      const author = clip(row.author, 100)
      const key = `${title}|${author}`.toLowerCase()
      if (!title || seen.has(key)) return []
      seen.add(key)
      const note = clip(row.note, 40)
      return [{ title, author, note: note || undefined }]
    })
    .slice(0, limit)
}

// Turns whatever the model returned into a safe, bounded suggestion. Anything
// malformed is dropped rather than repaired.
export function cleanSuggestion(goal: string, raw: unknown): Suggestion | null {
  const root = (raw ?? {}) as { paths?: unknown; books?: unknown; resources?: unknown }
  const paths: SuggestedPath[] = (Array.isArray(root.paths) ? root.paths : []).slice(0, MAX_PATHS).flatMap((item) => {
    const row = item as Record<string, unknown>
    const title = clip(row.title, 80)
    const milestones: PlanMilestone[] = (Array.isArray(row.milestones) ? row.milestones : [])
      .slice(0, 7)
      .flatMap((entry) => {
        const milestone = entry as Record<string, unknown>
        const label = clip(milestone.title, 60)
        const topics: PlanTopic[] = (Array.isArray(milestone.topics) ? milestone.topics : [])
          .slice(0, 6)
          .map((topic) => clip(topic, 100))
          .filter(Boolean)
          .map((topic) => ({ id: uid('topic'), label: topic, done: false }))
        const titles = (value: unknown) =>
          (Array.isArray(value) ? value : [])
            .map((entry) => clip(entry, 140))
            .filter(Boolean)
            .slice(0, 3)
        return label && topics.length
          ? [
              {
                id: uid('milestone'),
                title: label,
                topics,
                timeframe: clip(milestone.timeframe, 24) || undefined,
                outcome: clip(milestone.outcome, 180) || undefined,
                resourceTitles: titles(milestone.resources),
                bookTitles: titles(milestone.books),
                hours: hoursOf(milestone.hours),
              },
            ]
          : []
      })
    if (!title || milestones.length < 2) return []
    const own = cleanBooks(row.reading ?? row.books)
    return [
      {
        id: uid('plan'),
        title,
        summary: clip(row.summary, 260),
        weeks: clip(row.weeks, 24) || 'Self-paced',
        level: clip(row.level, 24) || 'Beginner',
        milestones,
        books: own,
      },
    ]
  })
  if (paths.length === 0) return null
  const books = cleanBooks(
    [...paths.flatMap((path) => path.books), ...(Array.isArray(root.books) ? root.books : [])],
    120,
  )

  const resources = cleanResources(root.resources)
  return { goal: clip(goal, 400), paths, books, resources }
}

export const HOURS_PER_TOPIC = 3

// Study hours for a stage: the model's estimate when it gave one, otherwise a
// flat allowance per topic.
export const stageHours = (milestone: PlanMilestone) => milestone.hours ?? milestone.topics.length * HOURS_PER_TOPIC

export function formatWeeks(weeks: number): string {
  if (weeks <= 1) return 'About 1 week'
  const low = Math.max(1, Math.floor(weeks * 0.85))
  const high = Math.ceil(weeks * 1.15)
  return low === high ? `About ${low} weeks` : `About ${low}–${high} weeks`
}

// Works out the schedule from the work in each stage and how many hours a week
// the learner has, instead of trusting a duration the model made up.
export function withSchedule(path: SuggestedPath, hoursPerWeek: number): SuggestedPath {
  const rate = Math.max(1, hoursPerWeek)
  let elapsed = 0
  const milestones = path.milestones.map((milestone) => {
    const start = Math.floor(elapsed / rate) + 1
    elapsed += stageHours(milestone)
    const end = Math.max(start, Math.ceil(elapsed / rate))
    return { ...milestone, timeframe: start === end ? `Week ${start}` : `Weeks ${start}–${end}` }
  })
  return { ...path, milestones, weeks: formatWeeks(elapsed / rate) }
}

export function topicCount(milestones: PlanMilestone[]): number {
  return milestones.reduce((sum, milestone) => sum + milestone.topics.length, 0)
}

export function planProgress(plan: Pick<PathPlan, 'milestones'>): { done: number; total: number; percent: number } {
  const total = topicCount(plan.milestones)
  const done = plan.milestones.reduce(
    (sum, milestone) => sum + milestone.topics.filter((topic) => topic.done).length,
    0,
  )
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}

export function milestoneDone(milestone: PlanMilestone): boolean {
  return milestone.topics.length > 0 && milestone.topics.every((topic) => topic.done)
}

// The first topic that is not done yet, in path order, with where it sits.
export function nextTopic(
  plan: Pick<PathPlan, 'milestones'>,
): { milestoneIndex: number; milestone: PlanMilestone; topic: PlanTopic } | null {
  for (const [milestoneIndex, milestone] of plan.milestones.entries()) {
    const topic = milestone.topics.find((item) => !item.done)
    if (topic) return { milestoneIndex, milestone, topic }
  }
  return null
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// The books and free resources the plan says to use for one stage. Titles that
// did not survive the checks (a dropped link, a book with no match) are skipped.
export function milestoneGuide(
  plan: Pick<PathPlan, 'books' | 'resources'>,
  milestone: Pick<PlanMilestone, 'resourceTitles' | 'bookTitles'>,
): { resources: PlanResource[]; books: ResolvedBook[] } {
  const resources = plan.resources.filter((resource) =>
    (milestone.resourceTitles ?? []).some((wanted) => sameName(wanted, resource.title)),
  )
  const books = plan.books.filter((book) =>
    (milestone.bookTitles ?? []).some(
      (wanted) => matchScore({ title: book.title, authors: book.authors }, wanted, '') > 0,
    ),
  )
  return { resources, books }
}

// Attaches freshly found books and free resources to one stage of a saved plan,
// keeping everything the plan already had.
export function addMaterials(
  plan: PathPlan,
  milestoneId: string,
  books: ResolvedBook[],
  resources: PlanResource[],
): PathPlan {
  const haveBook = (title: string) => plan.books.some((book) => sameName(book.title, title))
  const haveResource = (url: string) => plan.resources.some((resource) => resource.url === url)
  return {
    ...plan,
    books: [...plan.books, ...books.filter((book) => !haveBook(book.title))],
    resources: [...plan.resources, ...resources.filter((resource) => !haveResource(resource.url))],
    milestones: plan.milestones.map((milestone) =>
      milestone.id === milestoneId
        ? {
            ...milestone,
            bookTitles: [...new Set([...(milestone.bookTitles ?? []), ...books.map((book) => book.title)])].slice(-4),
            resourceTitles: [
              ...new Set([...(milestone.resourceTitles ?? []), ...resources.map((resource) => resource.title)]),
            ].slice(-4),
          }
        : milestone,
    ),
  }
}

export function toggleTopic(plan: PathPlan, topicId: string): PathPlan {
  return {
    ...plan,
    milestones: plan.milestones.map((milestone) => ({
      ...milestone,
      topics: milestone.topics.map((topic) => (topic.id === topicId ? { ...topic, done: !topic.done } : topic)),
    })),
  }
}

export function pathFromSuggestion(
  suggestion: Suggestion,
  path: SuggestedPath,
  books: ResolvedBook[],
  now = new Date(),
  hoursPerWeek?: number,
): LearningPath {
  const stamp = now.toISOString()
  return {
    id: `path-${crypto.randomUUID()}`,
    title: path.title,
    description: path.summary || `A path toward: ${suggestion.goal}`,
    bookIds: [],
    createdAt: stamp,
    updated: stamp,
    plan: {
      goal: suggestion.goal,
      summary: path.summary,
      weeks: path.weeks,
      level: path.level,
      milestones: path.milestones,
      hoursPerWeek,
      books,
      resources: suggestion.resources,
    },
  }
}

// ---- Matching a suggested book to a real record -------------------------

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'for', 'in', 'on', 'with', 'edition', 'ed'])
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOP.has(word))

export type BookRecord = {
  title: string
  authors: string[]
  year?: number
  isbn10?: string
  isbn13?: string
  coverUrl?: string
  rating?: number
  ratingsCount?: number
  ratings?: RatingSource[]
  price?: string
  description?: string
  buyLink?: string
  infoUrl?: string
  freeUrl?: string
}

// Scores how well a catalogue record matches what the AI asked for. Requires
// most of the title words to appear, and the author's surname when given.
export function matchScore(record: Pick<BookRecord, 'title' | 'authors'>, title: string, author: string): number {
  const wanted = words(title)
  if (wanted.length === 0) return 0
  const have = new Set(words(record.title))
  const hit = wanted.filter((word) => have.has(word)).length
  const titleScore = hit / wanted.length
  if (titleScore < 0.75) return 0
  if (author.trim()) {
    const surname = words(author).at(-1)
    const authors = record.authors.join(' ').toLowerCase()
    if (surname && !authors.includes(surname)) return 0
  }
  return titleScore
}

export function pickBook(records: BookRecord[], title: string, author: string): BookRecord | null {
  const scored = records
    .map((record) => ({ record, score: matchScore(record, title, author) }))
    .filter((item) => item.score > 0)
  if (scored.length === 0) return null
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.record.ratingsCount ?? 0) - (a.record.ratingsCount ?? 0) ||
      (b.record.year ?? 0) - (a.record.year ?? 0),
  )
  return scored[0].record
}

export function buyLinks(record: Pick<BookRecord, 'title' | 'authors' | 'isbn10' | 'isbn13' | 'buyLink'>): BookLinks[] {
  const query = encodeURIComponent(record.isbn13 ?? `${record.title} ${record.authors[0] ?? ''}`.trim())
  const links: BookLinks[] = [
    { store: 'Bookshop.org', url: `https://bookshop.org/search?keywords=${query}`, note: 'E-books are DRM-free' },
    {
      store: 'Amazon',
      url: record.isbn10 ? `https://www.amazon.com/dp/${record.isbn10}` : `https://www.amazon.com/s?k=${query}`,
      note: 'Kindle copies can’t be imported',
    },
  ]
  if (record.buyLink && isPublicHttps(record.buyLink))
    links.push({ store: 'Google Play Books', url: record.buyLink, note: 'Can’t be imported' })
  links.push({
    store: 'Find in a library',
    url: `https://search.worldcat.org/search?q=${query}`,
    note: 'Borrow for free',
  })
  return links
}

// Joins ratings from several sites into one average, weighted by how many people
// rated on each. Ignores sources with no ratings or an impossible average.
export function combineRatings(parts: RatingSource[]): {
  rating?: number
  ratingsCount?: number
  ratings?: RatingSource[]
} {
  const usable = parts.filter((part) => part.count > 0 && part.average >= 1 && part.average <= 5)
  if (usable.length === 0) return {}
  const total = usable.reduce((sum, part) => sum + part.count, 0)
  const average = usable.reduce((sum, part) => sum + part.average * part.count, 0) / total
  return { rating: Math.round(average * 100) / 100, ratingsCount: total, ratings: usable }
}

function ratingFields(record: BookRecord) {
  if (record.ratings?.length) return combineRatings(record.ratings)
  if (record.rating && record.ratingsCount) {
    return combineRatings([{ source: 'Google Books', average: record.rating, count: record.ratingsCount }])
  }
  return { rating: record.rating, ratingsCount: record.ratingsCount }
}

// Picks the best-reviewed books from a set of candidates. Raw averages mislead
// (a 5.0 from three people should not beat a 4.5 from thousands), so each book
// is scored by the rating we can be fairly sure it deserves: its average minus a
// penalty that shrinks as more people rate it. Books with enough ratings to trust
// come first; then books with only a handful of ratings; then books with none,
// in the order the AI listed them.
export function rankBooks(books: ResolvedBook[], limit = 10, doubt = 1.5, trustedVotes = 25): ResolvedBook[] {
  const indexed = books.map((book, index) => ({ book, index, votes: book.ratingsCount ?? 0 }))
  const isRated = (item: { book: ResolvedBook; votes: number }) => item.votes > 0 && Boolean(item.book.rating)
  const rated = indexed.filter(isRated)
  const unrated = indexed.filter((item) => !isRated(item))
  const score = (item: { book: ResolvedBook; votes: number }) => (item.book.rating ?? 0) - doubt / Math.sqrt(item.votes)
  const byScore = (a: (typeof rated)[number], b: (typeof rated)[number]) =>
    score(b) - score(a) || b.votes - a.votes || a.index - b.index
  const trusted = rated.filter((item) => item.votes >= trustedVotes).sort(byScore)
  const thin = rated.filter((item) => item.votes < trustedVotes).sort(byScore)
  return [...trusted, ...thin, ...unrated].map((item) => item.book).slice(0, limit)
}

export function resolvedFromRecord(record: BookRecord, note?: string): ResolvedBook {
  return {
    title: record.title,
    authors: record.authors,
    year: record.year,
    isbn: record.isbn13 ?? record.isbn10,
    coverUrl: record.coverUrl,
    ...ratingFields(record),
    price: record.price,
    note,
    description: record.description,
    buy: buyLinks(record),
    freeUrl: record.freeUrl,
    infoUrl: record.infoUrl,
  }
}

export const EXAMPLE_GOALS = [
  'Understand computer networking from beginner to job-ready',
  'Learn Python well enough to automate my work',
  'Prepare for the MCAT in six months',
  'Understand the basics of personal finance and investing',
  'Learn to write a novel',
]

// Used when the book catalogue could not be reached: the suggestion is kept, but
// marked as unverified and given search links instead of exact ones.
export function unverifiedBook(candidate: BookCandidate): ResolvedBook {
  return {
    title: candidate.title,
    authors: candidate.author ? [candidate.author] : [],
    note: candidate.note,
    buy: buyLinks({ title: candidate.title, authors: candidate.author ? [candidate.author] : [] }),
    unverified: true,
  }
}
