// Searching by meaning: comparing sentence vectors made on the device. All vectors are unit length,
// so the dot product is the cosine similarity.

export type Embed = (texts: string[]) => Promise<Float32Array[]>

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) sum += a[i] * b[i]
  return sum
}

// Mixes a keyword score (0..1, relative to the best keyword match) with how close the meaning is.
export function blendScore(keyword: number, meaning: number, weight = 0.5): number {
  return (1 - weight) * Math.max(0, Math.min(1, keyword)) + weight * Math.max(0, Math.min(1, meaning))
}

type Idea = { id: string; title: string; body: string }

const textOf = (note: Idea) => `${note.title}. ${note.body}`.slice(0, 1_500)

// Notes about the same thing even when they use different words.
export async function semanticRelated<T extends Idea>(
  note: T,
  others: T[],
  embed: Embed,
  cache: Map<string, Float32Array>,
  options: { limit?: number; threshold?: number } = {},
): Promise<Array<{ note: T; score: number }>> {
  const { limit = 3, threshold = 0.45 } = options
  const pool = others.filter((other) => other.id !== note.id).slice(0, 400)
  const key = (item: Idea) => `${item.id}:${textOf(item).length}`
  const wanted = [note, ...pool].filter((item) => !cache.has(key(item)))
  for (let start = 0; start < wanted.length; start += 24) {
    const batch = wanted.slice(start, start + 24)
    const vectors = await embed(batch.map(textOf))
    batch.forEach((item, index) => cache.set(key(item), vectors[index]))
  }
  const own = cache.get(key(note))
  if (!own) return []
  return pool
    .map((other) => ({ note: other, score: dot(own, cache.get(key(other)) ?? new Float32Array()) }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
