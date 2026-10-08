// Review cards and a small spaced-repetition scheduler (SM-2 style). Cards are
// created only after the learner approves a drafted question, and they link
// back to the note or book they came from.

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export type ReviewCard = {
  id: string
  question: string
  answer: string
  source: string
  noteId?: string
  bookId?: string
  bookTitle?: string
  createdAt: string
  dueAt: string
  intervalDays: number
  ease: number
  reps: number
  lapses: number
  updated?: string
}

export type DraftCard = { question: string; answer: string }

const KEY = 'noesis:review:v1'
const DAY = 86_400_000
const MINIMUM_EASE = 1.3

export function newCard(
  draft: DraftCard,
  origin: { source: string; noteId?: string; bookId?: string; bookTitle?: string },
  now = new Date(),
): ReviewCard {
  return {
    id: `card-${crypto.randomUUID()}`,
    question: draft.question,
    answer: draft.answer,
    source: origin.source,
    noteId: origin.noteId,
    bookId: origin.bookId,
    bookTitle: origin.bookTitle,
    createdAt: now.toISOString(),
    dueAt: now.toISOString(),
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    updated: now.toISOString(),
  }
}

export function gradeCard(card: ReviewCard, rating: ReviewRating, now = new Date()): ReviewCard {
  let { intervalDays, ease, reps, lapses } = card
  let dueAt: number
  if (rating === 'again') {
    lapses += 1
    reps = 0
    intervalDays = 0
    ease = Math.max(MINIMUM_EASE, ease - 0.2)
    dueAt = now.getTime() + 10 * 60_000
  } else {
    if (rating === 'hard') {
      intervalDays = Math.max(1, Math.round(Math.max(intervalDays, 1) * 1.2))
      ease = Math.max(MINIMUM_EASE, ease - 0.15)
    } else if (rating === 'good') {
      intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(intervalDays * ease)
    } else {
      intervalDays = reps === 0 ? 4 : Math.round(Math.max(intervalDays, 1) * ease * 1.3)
      ease += 0.15
    }
    reps += 1
    dueAt = now.getTime() + intervalDays * DAY
  }
  return { ...card, intervalDays, ease, reps, lapses, dueAt: new Date(dueAt).toISOString(), updated: now.toISOString() }
}

export function dueCards(cards: ReviewCard[], now = new Date()): ReviewCard[] {
  return cards
    .filter((card) => Date.parse(card.dueAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
}

function isCard(value: unknown): value is ReviewCard {
  const card = value as Partial<ReviewCard> | null
  return (
    !!card &&
    typeof card.id === 'string' &&
    typeof card.question === 'string' &&
    typeof card.answer === 'string' &&
    typeof card.dueAt === 'string' &&
    typeof card.createdAt === 'string' &&
    typeof card.intervalDays === 'number' &&
    typeof card.ease === 'number' &&
    typeof card.reps === 'number' &&
    typeof card.lapses === 'number'
  )
}

export function readReviewCards(): ReviewCard[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter(isCard) : []
  } catch {
    return []
  }
}

export function writeReviewCards(cards: ReviewCard[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards))
  } catch {
    // Storage can be unavailable in private browsing.
  }
}
