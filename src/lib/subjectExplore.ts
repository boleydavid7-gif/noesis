// Finds things to explore for a question, in the background: the short answer and the picks are asked for at the
// same time, each is saved the moment it arrives, and books (which need a catalog lookup) are added last.
// One question is never asked for twice at once, so a page and the background share the same work.
import { exploreQuestion, resolveBooks } from './pathClient'
import type { LearningPath } from './pathPlan'
import { withAnswerPart, withPicks, type Pick, type Question, type Subject } from './subjects'
import { withDoors } from './rabbitHole'

export type EditSubject = (pathId: string, change: (subject: Subject) => Subject) => void

const running = new Map<string, Promise<void>>()
const failed = new Map<string, string>()
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((listener) => listener())

export const subscribeExploring = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const isExploring = (questionId: string) => running.has(questionId)
export const exploreError = (questionId: string) => failed.get(questionId) ?? ''

export function exploreInto(
  input: {
    path: LearningPath
    question: Question
    area?: string
    level?: string
    reading: string[]
    fresh?: boolean
    trail?: string[]
    context?: string
    /** Only the reading list (the answer is already there): one use of Noema. */
    picksOnly?: boolean
  },
  edit: EditSubject,
): Promise<void> {
  const { path, question } = input
  const already = running.get(question.id)
  if (already) return already
  failed.delete(question.id)
  const base = {
    subject: path.title,
    area: input.area,
    question: question.text,
    level: input.level,
    reading: input.reading,
    trail: input.trail,
    context: input.context,
  }
  // The answer comes first, with its doors; the reading list follows with the answer's ticket, so the step is one
  // use of Noema, not two.
  const answer: Promise<string | undefined> = input.picksOnly
    ? Promise.resolve(undefined)
    : exploreQuestion({ ...base, part: 'answer' }).then((found) => {
        edit(path.id, (subject) => withDoors(withAnswerPart(subject, question.id, found), question.id, found.doors))
        return found.ticket
      })
  const picks = answer
    .catch(() => undefined)
    .then((ticket) => exploreQuestion({ ...base, part: 'picks', ticket }))
    .then(async (found) => {
      edit(path.id, (subject) => withPicks(subject, question.id, found.picks, input.fresh))
      const books = await resolveBooks(found.books).catch(() => [])
      if (!books.length) return
      const bookPicks: Array<Omit<Pick, 'id'>> = books.map((book) => ({
        type: 'book',
        title: book.title,
        source: book.authors.slice(0, 2).join(', '),
        url: book.infoUrl,
        why: book.note,
        book: { ...book, description: undefined },
      }))
      edit(path.id, (subject) => withPicks(subject, question.id, bookPicks))
    })
  const work = Promise.allSettled([answer, picks]).then(([a, p]) => {
    const reason = (a.status === 'rejected' ? a.reason : p.status === 'rejected' ? p.reason : null) as {
      message?: string
    } | null
    if (!reason) return
    failed.set(
      question.id,
      reason?.constructor?.name === 'AuthRequiredError'
        ? 'Sign in to go down rabbit holes.'
        : reason?.message || 'Noema could not find things right now.',
    )
  })
  running.set(question.id, work)
  tell()
  void work.finally(() => {
    running.delete(question.id)
    tell()
  })
  return work
}

// Questions worth filling in before they are opened: the ones in Now, then the next one suggested.
export function questionsToPrepare(subject: Subject, nextUp: Question | null): Question[] {
  const now = subject.questions.filter((q) => q.state === 'now')
  return [...now, ...(nextUp ? [nextUp] : [])].filter((q) => !q.picks)
}
