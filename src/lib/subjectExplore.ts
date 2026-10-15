// Finds things to explore for a question, in the background: the short answer and the picks are asked for at the
// same time, each is saved the moment it arrives, and books (which need a catalog lookup) are added last.
// One question is never asked for twice at once, so a page and the background share the same work.
import { exploreQuestion, resolveBooks } from './pathClient'
import type { LearningPath } from './pathPlan'
import { withAnswerPart, withPicks, type Pick, type Question, type Subject } from './subjects'

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
  input: { path: LearningPath; question: Question; area?: string; level?: string; reading: string[]; fresh?: boolean },
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
  }
  const answer = exploreQuestion({ ...base, part: 'answer' }).then((found) =>
    edit(path.id, (subject) => withAnswerPart(subject, question.id, found)),
  )
  const picks = exploreQuestion({ ...base, part: 'picks' }).then(async (found) => {
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
    if (p.status === 'rejected') {
      const reason = p.reason as { message?: string; name?: string }
      failed.set(
        question.id,
        reason?.constructor?.name === 'AuthRequiredError'
          ? 'Sign in to find things to explore.'
          : reason?.message || 'Noema could not find things right now.',
      )
      // The answer part may still have come in; the picks can be asked for again.
      if (a.status === 'rejected') return
    }
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
