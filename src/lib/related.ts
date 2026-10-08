import { tokenize } from './retrieval'

type Idea = { id: string; title: string; body: string }

// Notes that talk about the same things, found by shared words weighted by how rare they are.
// Runs on the device and uses no AI.
export function relatedNotes<T extends Idea>(note: T, others: T[], limit = 3): Array<{ note: T; shared: string[] }> {
  const docs = others.filter((other) => other.id !== note.id)
  if (docs.length === 0) return []
  const terms = (item: Idea) => new Set(tokenize(`${item.title} ${item.body}`))
  const own = terms(note)
  if (own.size === 0) return []
  const all = [note, ...docs].map(terms)
  const frequency = new Map<string, number>()
  for (const set of all) for (const term of set) frequency.set(term, (frequency.get(term) ?? 0) + 1)
  const weight = (term: string) => Math.log(1 + all.length / (frequency.get(term) ?? 1))
  return docs
    .map((other, index) => {
      const theirs = all[index + 1]
      const shared = [...own].filter((term) => theirs.has(term))
      const score = shared.reduce((sum, term) => sum + weight(term), 0) / Math.sqrt(theirs.size || 1)
      return { note: other, shared: shared.sort((a, b) => weight(b) - weight(a)).slice(0, 3), score }
    })
    .filter((item) => item.shared.length >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ note: found, shared }) => ({ note: found, shared }))
}
