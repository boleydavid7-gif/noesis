import type { GoalPeriod } from './settings'

type Finishable = { finished?: string }

export function periodStart(now: Date, period: GoalPeriod): Date {
  return period === 'year' ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), 1)
}

// How many books were finished in the current month or year, against the learner's own target.
export function goalProgress(
  books: Finishable[],
  goal: { target: number; period: GoalPeriod },
  now = new Date(),
): { done: number; target: number; percent: number } {
  const since = periodStart(now, goal.period).getTime()
  const done = books.filter((book) => book.finished && Date.parse(book.finished) >= since).length
  const target = Math.max(1, goal.target)
  return { done, target, percent: Math.min(100, Math.round((done / target) * 100)) }
}
