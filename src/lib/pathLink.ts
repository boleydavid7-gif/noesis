// Connects a book in the library to the stage of a learning path it belongs to.

import type { LearningPath, PlanMilestone } from './pathPlan'
import { matchScore, nextTopic } from './pathPlan'

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
