// Finds where a stretch of read-aloud text sits in a page, so the word being spoken can be marked.
// Text is measured the way the speech is cut: runs of spaces count as one, and the ends are trimmed.

export type TextPlace = { part: number; offset: number }

// `parts` are the text pieces of a block in order; start and end count characters in the flattened text.
export function locateRange(parts: string[], start: number, end: number): { start: TextPlace; end: TextPlace } | null {
  let index = 0
  let previousSpace = true
  let from: TextPlace | null = null
  let to: TextPlace | null = null
  for (let part = 0; part < parts.length; part += 1) {
    const text = parts[part]
    for (let offset = 0; offset < text.length; offset += 1) {
      const space = /\s/.test(text[offset])
      if (space && previousSpace) continue
      if (index === start && !from) from = { part, offset }
      if (index === end - 1) to = { part, offset: offset + 1 }
      index += 1
      previousSpace = space
      if (to && from) return { start: from, end: to }
    }
  }
  return from && to ? { start: from, end: to } : null
}

// The word that starts at a position, up to the next space.
export function wordAt(text: string, index: number): { start: number; end: number } {
  let end = index
  while (end < text.length && !/\s/.test(text[end])) end += 1
  return { start: index, end: Math.max(end, index + 1) }
}
