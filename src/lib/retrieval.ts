// Lightweight passage retrieval over an imported book. Book text is stored as
// one string with a blank line between spine sections (see parseEpub), so a
// chunk's `section` is its 1-based position among the sections that had text.

export type BookChunk = { id: number; section: number; text: string }
export type RetrievedChunk = BookChunk & { score: number }

const STOPWORDS = new Set(
  'the and for are but not you all any can had her was one our out has his how its may new now old see two way who did get let put say she too use that with have this will your from they know want been much some what when where which while about would there their these those into than then them were said each also just like over such only does done make made'.split(
    ' ',
  ),
)

export function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length > 2 && !STOPWORDS.has(term))
}

export function chunkBook(text: string, targetChars = 1_200): BookChunk[] {
  const chunks: BookChunk[] = []
  const sections = text
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean)
  sections.forEach((section, sectionIndex) => {
    const sentences = section.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [section]
    let current = ''
    const flush = () => {
      const trimmed = current.trim()
      if (trimmed) chunks.push({ id: chunks.length, section: sectionIndex + 1, text: trimmed })
      current = ''
    }
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > targetChars) flush()
      current += sentence
      // A sentence-less wall of text still has to be split somewhere.
      while (current.length > targetChars * 2) {
        chunks.push({ id: chunks.length, section: sectionIndex + 1, text: current.slice(0, targetChars).trim() })
        current = current.slice(targetChars)
      }
    }
    flush()
  })
  return chunks
}

// BM25 over chunks. Returns only chunks that share at least one query term.
export function retrieveChunks(chunks: BookChunk[], query: string, limit = 6): RetrievedChunk[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0 || chunks.length === 0) return []
  const tokenized = chunks.map((chunk) => tokenize(chunk.text))
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / chunks.length || 1
  const documentFrequency = new Map<string, number>()
  for (const tokens of tokenized)
    for (const term of new Set(tokens)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  const k1 = 1.5
  const b = 0.75
  const scored: RetrievedChunk[] = []
  tokenized.forEach((tokens, index) => {
    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    let score = 0
    for (const term of terms) {
      const frequency = counts.get(term)
      if (!frequency) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5))
      score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * tokens.length) / averageLength)))
    }
    if (score > 0) scored.push({ ...chunks[index], score })
  })
  return scored.sort((a, b2) => b2.score - a.score).slice(0, limit)
}

// Builds the "Additional book context" block: best-matching passages first
// chosen by score, then shown in reading order, each labelled with its section
// so the tutor can cite where an answer came from.
export function retrievedContext(text: string, question: string, budget = 12_000): string {
  const chunks = chunkBook(text)
  let picked = retrieveChunks(chunks, question, 12)
  if (picked.length === 0) picked = chunks.slice(0, 4).map((chunk) => ({ ...chunk, score: 0 }))
  const kept: RetrievedChunk[] = []
  let used = 0
  for (const chunk of picked) {
    if (used + chunk.text.length > budget && kept.length > 0) break
    kept.push(chunk)
    used += chunk.text.length
  }
  return kept
    .sort((a, b) => a.id - b.id)
    .map((chunk) => `[Section ${chunk.section}] ${chunk.text}`)
    .join('\n\n')
}
