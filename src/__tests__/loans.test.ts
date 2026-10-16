import { describe, expect, it } from 'vitest'
import {
  activeLoans,
  bookForLoan,
  isLibbyBook,
  libbyBooksWithoutLoan,
  dueSoon,
  dueText,
  LIBBY_SHELF,
  newLoan,
  renewed,
  renewLink,
  returned,
  weeksFrom,
} from '../lib/loans'

const loan = (due: string, extra = {}) =>
  newLoan({ title: 'Meditations', kind: 'ebook', due, ...extra }, new Date('2026-10-01T10:00:00'))

describe('loans', () => {
  it('says the due date plainly', () => {
    expect(dueText({ due: '2026-10-15' }, '2026-10-15')).toBe('Due today')
    expect(dueText({ due: '2026-10-16' }, '2026-10-15')).toBe('Due tomorrow')
    expect(dueText({ due: '2026-10-18' }, '2026-10-15')).toBe('Due in 3 days')
    expect(dueText({ due: '2026-10-26' }, '2026-10-15')).toBe('Due Mon, Oct 26')
    expect(dueText({ due: '2026-10-10' }, '2026-10-15')).toBe('Was due Oct 10')
  })

  it('lists what is due soon, soonest first, without returned ones', () => {
    const a = loan('2026-10-30')
    const b = loan('2026-10-16')
    const c = returned(loan('2026-10-15'))
    const d = loan('2026-10-12')
    expect(activeLoans([a, b, c, d]).map((item) => item.due)).toEqual(['2026-10-12', '2026-10-16', '2026-10-30'])
    expect(dueSoon([a, b, c, d], '2026-10-15').map((item) => item.due)).toEqual(['2026-10-12', '2026-10-16'])
  })

  it('renews at the right place', () => {
    expect(renewLink(loan('2026-10-20', { renewUrl: 'https://example.org/acct' }), null)).toBe(
      'https://example.org/acct',
    )
    expect(renewLink(loan('2026-10-20'), null)).toBe(LIBBY_SHELF)
    const paper = loan('2026-10-20', { kind: 'physical' })
    expect(renewLink(paper, { catalog: 'seattle', website: 'https://spl.org' } as never)).toBe(
      'https://seattle.bibliocommons.com/v2/checkedout',
    )
    expect(renewLink(paper, { website: 'https://spl.org' } as never)).toBe('https://spl.org')
    expect(renewLink(paper, null)).toBeUndefined()
  })

  it('records renewals and returns', () => {
    const first = renewed(loan('2026-10-20'), '2026-11-10')
    expect(first.due).toBe('2026-11-10')
    expect(renewed(first, '2026-12-01').renewals).toBe(2)
    expect(returned(first).returnedAt).toBeTruthy()
    expect(weeksFrom('2026-10-15', 3)).toBe('2026-11-05')
  })
})

describe('Libby books under Borrowed', () => {
  const libby = { id: 'b1', title: 'The Overstory', format: 'external' as const, store: 'Libby' }
  const kindle = { id: 'b2', title: 'Dune', format: 'external' as const, store: 'Kindle' }
  const byLink = { id: 'b3', title: 'Circe', format: 'external' as const, externalUrl: 'https://libbyapp.com/shelf' }
  const loan = newLoan({ title: 'the overstory', kind: 'ebook', due: '2026-10-30' })

  it('knows a Libby e-book by its store or its link', () => {
    expect([libby, kindle, byLink].map(isLibbyBook)).toEqual([true, false, true])
  })

  it('joins a loan to the Libby e-book of the same title, and lists the rest without a due date', () => {
    expect(bookForLoan(loan, [kindle, libby])).toBe(libby)
    expect(bookForLoan({ ...loan, kind: 'physical' }, [libby])).toBeUndefined()
    expect(libbyBooksWithoutLoan([libby, kindle, byLink], [loan])).toEqual([byLink])
    expect(libbyBooksWithoutLoan([libby], [{ ...loan, returnedAt: '2026-10-01' }])).toEqual([libby])
  })
})
