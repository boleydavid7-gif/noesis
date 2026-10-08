import { describe, expect, it } from 'vitest'
import { chunkBook, retrieveChunks, retrievedContext, tokenize } from '../lib/retrieval'

const book = [
  'Chapter one is about cooking. Bread needs flour and water. Yeast makes the dough rise slowly overnight.',
  'Chapter two covers astronomy. Jupiter is the largest planet. Its moons include Io and Europa.',
  'Chapter three discusses photosynthesis. Chlorophyll absorbs light so plants convert carbon dioxide into sugar.',
].join('\n\n')

describe('retrieval', () => {
  it('drops stopwords and short tokens', () => {
    expect(tokenize('What is the largest planet?')).toEqual(['largest', 'planet'])
  })

  it('keeps chunks tied to their section', () => {
    expect(chunkBook(book).map((chunk) => chunk.section)).toEqual([1, 2, 3])
  })

  it('splits long text without sentence breaks', () => {
    const chunks = chunkBook('word '.repeat(2_000), 500)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every((chunk) => chunk.text.length <= 1_000)).toBe(true)
  })

  it('ranks the relevant section first', () => {
    const [top] = retrieveChunks(chunkBook(book), 'How do plants use chlorophyll?')
    expect(top.section).toBe(3)
  })

  it('returns nothing when no terms match', () => {
    expect(retrieveChunks(chunkBook(book), 'zebra')).toEqual([])
  })

  it('labels sections and falls back to the opening when nothing matches', () => {
    expect(retrievedContext(book, 'Which moons orbit Jupiter?')).toContain('[Section 2]')
    expect(retrievedContext(book, 'zebra')).toContain('[Section 1]')
  })

  it('respects the character budget', () => {
    const long = Array.from(
      { length: 30 },
      (_, i) => `Section ${i} mentions gravity here. ${'filler words go here. '.repeat(60)}`,
    ).join('\n\n')
    expect(retrievedContext(long, 'gravity', 3_000).length).toBeLessThan(6_000)
  })
})
