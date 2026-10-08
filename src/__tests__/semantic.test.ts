import { describe, expect, it } from 'vitest'
import { blendScore, dot, semanticRelated, type Embed } from '../lib/semantic'
import { searchLibrary, type MeaningSearch } from '../lib/librarySearch'

// A stand-in model: texts that share a topic word land close together.
const TOPICS = ['money', 'cooking', 'sleep']
const SYNONYMS: Record<string, string> = {
  savings: 'money',
  interest: 'money',
  cash: 'money',
  pasta: 'cooking',
  boil: 'cooking',
  rest: 'sleep',
  nap: 'sleep',
}
const fake: Embed = async (texts) =>
  texts.map((text) => {
    const vector = new Float32Array(TOPICS.length)
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      const topic = SYNONYMS[word] ?? word
      const at = TOPICS.indexOf(topic)
      if (at >= 0) vector[at] += 1
    }
    const length = Math.hypot(...vector) || 1
    return vector.map((value) => value / length) as Float32Array
  })

describe('semantic helpers', () => {
  it('compares vectors and blends scores within range', async () => {
    const [a, b, c] = await fake(['savings', 'cash', 'pasta'])
    expect(dot(a, b)).toBeCloseTo(1)
    expect(dot(a, c)).toBeCloseTo(0)
    expect(blendScore(2, -1)).toBe(0.5)
  })

  it('finds notes that mean the same thing without sharing words', async () => {
    const notes = [
      { id: '1', title: 'Savings', body: 'Put cash aside.' },
      { id: '2', title: 'Interest', body: 'Money grows slowly.' },
      { id: '3', title: 'Dinner', body: 'Boil the pasta.' },
    ]
    const found = await semanticRelated(notes[0], notes, fake, new Map())
    expect(found.map((item) => item.note.id)).toEqual(['2'])
  })
})

describe('library search by meaning', () => {
  const books = [
    { id: 'a', title: 'Money Book', author: 'A' },
    { id: 'b', title: 'Cook Book', author: 'B' },
  ]
  const texts: Record<string, string> = {
    a: 'Interest builds on savings year after year. Cash left alone becomes more cash.',
    b: 'Boil the pasta for ten minutes. Drain and add sauce.',
  }
  const meaning: MeaningSearch = {
    embed: fake,
    vectorsFor: async (_id, passages) => fake(passages),
  }

  it('finds the passage whose words differ from the question', async () => {
    const hits = await searchLibrary(books, 'how does cash grow', async (id) => texts[id], 5, meaning)
    expect(hits[0].bookId).toBe('a')
  })

  it('still works by words alone when the model is unavailable', async () => {
    const hits = await searchLibrary(books, 'boil pasta', async (id) => texts[id], 5, {
      embed: async () => {
        throw new Error('no model')
      },
      vectorsFor: async () => {
        throw new Error('no model')
      },
    })
    expect(hits[0].bookId).toBe('b')
  })
})
