import { describe, expect, it } from 'vitest'
import { planFolderScan, sameFile } from './libraryFolder'
import { pickMatch, commonFolder, dropboxArg } from './cloudFind'

describe('library folder', () => {
  const shelf = [{ id: 'm', fileName: 'Meditations.epub', fileSize: 100 }]

  it('adds each new file once and links what the library already has', () => {
    const plan = planFolderScan(
      [
        { path: 'Meditations.epub', size: 100 },
        { path: 'Stoics/Meditations.epub', size: 100 },
        { path: 'b/Letters.epub', size: 20 },
        { path: 'a/Letters.epub', size: 20 },
        { path: 'cover.jpg', size: 3 },
        { path: '.hidden.epub', size: 3 },
      ],
      {},
      shelf,
    )
    expect(plan.link).toEqual([
      { path: 'Meditations.epub', bookId: 'm' },
      { path: 'Stoics/Meditations.epub', bookId: 'm' },
    ])
    expect(plan.add).toEqual(['a/Letters.epub'])
    expect(plan.same).toEqual([{ path: 'b/Letters.epub', as: 'a/Letters.epub' }])
  })

  it('replaces a changed file of a folder book and never brings back a removed one', () => {
    const plan = planFolderScan(
      [
        { path: 'Meditations.epub', size: 120 },
        { path: 'Gone.epub', size: 5 },
      ],
      { 'Meditations.epub': { bookId: 'm', size: 100 }, 'Gone.epub': { bookId: 'g', size: 5 } },
      shelf,
    )
    expect(plan).toEqual({ add: [], replace: [{ path: 'Meditations.epub', bookId: 'm' }], link: [], same: [] })
  })

  it('compares names case aside and sizes when both are known', () => {
    expect(sameFile({ id: 'x', fileName: 'A.EPUB', fileSize: 10 }, 'a.epub', 10)).toBe(true)
    expect(sameFile({ id: 'x', fileName: 'A.EPUB', fileSize: 10 }, 'a.epub', 11)).toBe(false)
    expect(sameFile({ id: 'x', fileName: 'A.EPUB' }, 'a.epub', 11)).toBe(true)
  })
})

describe('finding in the storage', () => {
  it('takes the same name and size', () => {
    const found = [
      { name: 'meditations.epub', size: 9 },
      { name: 'Meditations.epub', size: 10 },
    ]
    expect(pickMatch(found, 'Meditations.EPUB', 10)).toEqual({ name: 'Meditations.epub', size: 10 })
    expect(pickMatch(found, 'Letters.pdf', 10)).toBeUndefined()
  })

  it('escapes Dropbox arguments and finds a shared folder', () => {
    expect(dropboxArg({ path: '/Bücher' })).toBe('{"path":"/B\\u00fccher"}')
    expect(commonFolder(['/Books/a.epub', '/Books/b/c.pdf'])).toBe('/Books')
  })
})
