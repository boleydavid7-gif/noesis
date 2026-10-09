// A book's contents list mixes true chapters with the sections inside them. Moving "to the next chapter"
// must never land in the middle of a chapter that has already been read, so stepping and counting use
// chapters only, while the contents list still shows every section.

export type StepEntry = { href: string; level?: number }

const fileOf = (href: string) => href.split('#')[0]

/** For each contents entry: true when it starts a chapter, false when it is a section inside one. */
export function chapterFlags(entries: StepEntry[]): boolean[] {
  const files = new Set(entries.map((entry) => fileOf(entry.href)))
  const hasLevels = entries.some((entry) => (entry.level ?? 0) > 0)
  const firstLevel = new Map<string, number>()
  return entries.map((entry) => {
    const file = fileOf(entry.href)
    const level = entry.level ?? 0
    if (!firstLevel.has(file)) {
      firstLevel.set(file, level)
      return true
    }
    // A later entry in a file already begun. With nesting known, a deeper one is a section and a peer is another
    // chapter in the same file. Without it, a book of several files treats repeats as sections, while a book
    // that lives in one or two files must be using anchors as its chapters.
    if (hasLevels) return level <= (firstLevel.get(file) ?? 0)
    return files.size < 3
  })
}

/** The next chapter after this entry, or -1 at the end. */
export function nextChapterIndex(entries: StepEntry[], from: number): number {
  const flags = chapterFlags(entries)
  for (let index = Math.max(-1, from) + 1; index < entries.length; index += 1) if (flags[index]) return index
  return -1
}

/** The chapter before this entry (the start of the current chapter when inside one), or -1 at the start. */
export function previousChapterIndex(entries: StepEntry[], from: number): number {
  const flags = chapterFlags(entries)
  for (let index = Math.min(entries.length, from) - 1; index >= 0; index -= 1) if (flags[index]) return index
  return -1
}

/** 1-based place of the chapter this entry belongs to, and how many chapters there are. */
export function chapterPlace(entries: StepEntry[], at: number): { ordinal: number; total: number } {
  const flags = chapterFlags(entries)
  const total = Math.max(1, flags.filter(Boolean).length)
  let ordinal = 0
  for (let index = 0; index <= Math.min(at, entries.length - 1); index += 1) if (flags[index]) ordinal += 1
  return { ordinal: Math.max(1, ordinal), total }
}

/** Whole-book progress (0-100) from the chapter the reader is in and how far through it they are. */
export function bookProgress(entries: StepEntry[], at: number, fraction: number): number {
  const { ordinal, total } = chapterPlace(entries, at)
  const part = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  return Math.round(((ordinal - 1 + part) / total) * 100)
}

/** The entry where the chapter containing this one begins (itself when it is a chapter), or -1. */
export function chapterStartIndex(entries: StepEntry[], at: number): number {
  const flags = chapterFlags(entries)
  for (let index = Math.min(entries.length - 1, at); index >= 0; index -= 1) if (flags[index]) return index
  return -1
}
