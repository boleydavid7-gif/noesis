// Connects a book in the library to the stage of a learning path it belongs to.

import type { LearningPath, PlanMilestone } from './pathPlan'
import { matchScore, milestoneDone, nextTopic } from './pathPlan'

type BookLike = { id: string; title: string; author?: string }

export type StudyLink = {
  path: LearningPath
  milestone: PlanMilestone
  milestoneIndex: number
}

const matchesTitle = (book: BookLike, wanted: string) =>
  matchScore({ title: book.title, authors: book.author ? [book.author] : [] }, wanted, '') > 0 ||
  matchScore({ title: wanted, authors: [] }, book.title, '') > 0

// The stage a book is being read for, if any. A stage that names the book wins; a book added to a path
// by hand belongs to the stage the learner is on.
export function studyFor(book: BookLike, paths: LearningPath[]): StudyLink | null {
  for (const path of paths) {
    const plan = path.plan
    if (!plan) continue
    for (const [milestoneIndex, milestone] of plan.milestones.entries()) {
      if ((milestone.bookTitles ?? []).some((wanted) => matchesTitle(book, wanted)))
        return { path, milestone, milestoneIndex }
    }
  }
  for (const path of paths) {
    if (!path.plan || !path.bookIds.includes(book.id)) continue
    const next = nextTopic(path.plan)
    const index = next ? next.milestoneIndex : path.plan.milestones.length - 1
    const milestone = path.plan.milestones[index]
    if (milestone) return { path, milestone, milestoneIndex: index }
  }
  return null
}

// Library books that a stage names, so the stage can offer to open them.
export function libraryBooksForStage<T extends BookLike>(milestone: PlanMilestone, books: T[]): T[] {
  const wanted = milestone.bookTitles ?? []
  return books.filter((book) => wanted.some((title) => matchesTitle(book, title)))
}

// The stage you are on: the first one not moved past, ticked off earlier, or finished by reading its books.
export function currentStage(
  path: LearningPath,
  library: Array<BookLike & { progress: number; finished?: string }>,
): { milestone: PlanMilestone; index: number } | null {
  const plan = path.plan
  if (!plan) return null
  for (const [index, milestone] of plan.milestones.entries()) {
    if (milestoneDone(milestone)) continue
    const owned = libraryBooksForStage(milestone, library)
    if (owned.length > 0 && owned.every((book) => book.finished || book.progress >= 98)) continue
    return { milestone, index }
  }
  return null
}

export type ReadNext =
  | { kind: 'continue' | 'start'; book: { id: string; title: string }; stage: string; why?: string }
  | { kind: 'get'; title: string; stage: string; why?: string }
  | { kind: 'read'; title: string; url: string; stage: string; why?: string }
  | { kind: 'finished-all'; titles: string[]; stage: string }
  | { kind: 'find'; stage: string }

type LibraryItem = BookLike & { progress: number; finished?: string }

// What to read next on a path: the book already in the library for the stage you are on, then a book to get,
// then a free source, and only then a prompt to find materials. Null when every topic is done.
export function readNextOnPath(path: LearningPath, library: LibraryItem[]): ReadNext | null {
  const plan = path.plan
  if (!plan) return null
  const current = currentStage(path, library)
  if (!current) return null
  const stage = current.milestone
  const owned = libraryBooksForStage(stage, library)
  const done = (book: LibraryItem) => Boolean(book.finished) || book.progress >= 98
  const started = owned.find((book) => !done(book) && book.progress > 0)
  const fresh = owned.find((book) => !done(book))
  const noteFor = (title: string) =>
    plan.books.find(
      (book) => matchesTitle({ id: '', title: book.title }, title) || matchesTitle({ id: '', title }, book.title),
    )?.note
  if (started) return { kind: 'continue', book: started, stage: stage.title, why: noteFor(started.title) }
  if (fresh) return { kind: 'start', book: fresh, stage: stage.title, why: noteFor(fresh.title) }
  if (owned.length > 0) return { kind: 'finished-all', titles: owned.map((book) => book.title), stage: stage.title }
  const wanted = (stage.bookTitles ?? []).find((title) => !library.some((book) => matchesTitle(book, title)))
  if (wanted) return { kind: 'get', title: wanted, stage: stage.title, why: noteFor(wanted) }
  const resource = plan.resources.find((item) =>
    (stage.resourceTitles ?? []).some((title) => title.trim().toLowerCase() === item.title.trim().toLowerCase()),
  )
  if (resource)
    return { kind: 'read', title: resource.title, url: resource.url, stage: stage.title, why: resource.note }
  return { kind: 'find', stage: stage.title }
}
