import { describe, expect, it } from 'vitest'
import { checkLibbyCode, libbyLoans, loansFromSync, LibbyError, startLibbyCode } from '../workerLibby'
import { libbyDue, mergeLibbyLoans } from '../lib/libbyLink'
import { newLoan, type Loan } from '../lib/loans'

const SYNC = {
  result: 'synchronized',
  cards: [{ cardId: '9', advantageKey: 'lapl', library: { name: 'Los Angeles Public Library' } }],
  loans: [
    {
      id: '1234567',
      title: 'The Overstory',
      firstCreatorName: 'Richard Powers',
      type: { id: 'ebook' },
      expireDate: '2026-10-30T14:00:00Z',
      checkoutDate: '2026-10-09T14:00:00Z',
      cardId: '9',
      covers: { cover300Wide: { href: 'https://img1.od-cdn.com/ImageType-100/x.jpg' } },
    },
    { id: '55', title: 'A Magazine', type: { id: 'magazine' }, expireDate: '2026-10-30T14:00:00Z' },
    { id: 'bad', title: 'Odd row', type: { id: 'ebook' }, expireDate: 'soon' },
  ],
}

type Call = { url: string; init?: RequestInit }
const fakeFetch = (answers: Array<[number, unknown]>, calls: Call[] = []) => {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const [status, body] = answers.shift() ?? [500, {}]
    return new Response(JSON.stringify(body), { status })
  }
}

describe('Libby bridge', () => {
  it('reads loans: due date, cover, library and a link to the book; magazines and odd rows left out', () => {
    expect(loansFromSync(SYNC)).toEqual([
      {
        id: '1234567',
        title: 'The Overstory',
        author: 'Richard Powers',
        kind: 'ebook',
        due: '2026-10-30T14:00:00Z',
        borrowed: '2026-10-09T14:00:00Z',
        cover: 'https://img1.od-cdn.com/ImageType-100/x.jpg',
        library: 'Los Angeles Public Library',
        libraryKey: 'lapl',
        link: 'https://share.libbyapp.com/title/1234567',
      },
    ])
    expect(loansFromSync({})).toEqual([])
  })

  it('starts as a new device and gets a code from Libby to show', async () => {
    const calls: Call[] = []
    const fetcher = fakeFetch(
      [
        [200, { identity: 'first' }],
        [200, { code: '12345678', expiry: 1760000000 }],
      ],
      calls,
    )
    await expect(startLibbyCode(fetcher)).resolves.toEqual({
      token: 'first',
      host: 'https://sentry.libbyapp.com',
      code: '12345678',
    })
    expect(calls.map((call) => call.url.replace('https://sentry.libbyapp.com', ''))).toEqual([
      '/chip?client=dewey',
      '/chip/clone/code',
    ])
    expect(calls[1].init?.method ?? 'GET').toBe('GET')
    expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer first')
    expect(new Headers(calls[0].init?.headers).get('origin')).toBe('https://libbyapp.com')
  })

  it('tries the older address when the new one turns the request away, and keeps the one that answered', async () => {
    const calls: Call[] = []
    const fetcher = fakeFetch(
      [
        [403, {}],
        [200, { identity: 'first' }],
        [200, { code: '87654321' }],
      ],
      calls,
    )
    await expect(startLibbyCode(fetcher)).resolves.toMatchObject({
      host: 'https://sentry-read.svc.overdrive.com',
      code: '87654321',
    })
  })

  it('names the step and what came back when Libby does not answer', async () => {
    await expect(
      startLibbyCode(
        fakeFetch([
          [403, {}],
          [503, {}],
        ]),
      ),
    ).rejects.toThrow('Libby did not answer (starting, 503).')
    await expect(
      startLibbyCode(
        fakeFetch([
          [200, { identity: 'first' }],
          [200, { result: 'nope' }],
        ]),
      ),
    ).rejects.toThrow('Libby did not answer (code, sent result).')
  })

  it('waits until the reader’s Libby has copied a library card over, and says what Libby reports', async () => {
    const waiting = await checkLibbyCode(
      fakeFetch([
        [200, { code: '12345678', expiry: 1 }],
        [200, { identity: 'second' }],
        [200, { result: 'synchronized', cards: [] }],
        [200, { result: 'synchronized', cards: [] }],
      ]),
      'first',
      'https://sentry.libbyapp.com',
    )
    expect(waiting).toEqual({
      joined: false,
      token: 'second',
      seen: 'code: [code, expiry]; sync: synchronized [cards]; cards: 0; new token',
    })
    const joined = await checkLibbyCode(
      fakeFetch([
        [404, {}],
        [200, { identity: 'third' }],
        [200, SYNC],
      ]),
      'second',
      'https://sentry.libbyapp.com',
    )
    expect(joined).toMatchObject({ joined: true, token: 'third' })
    expect(joined.seen).toContain('code: (404).')
  })

  it('says what Libby sent when a joined device has no card yet, and asks to connect again when refused', async () => {
    await expect(libbyLoans(fakeFetch([[200, { result: 'synchronized', loans: [] }]]), 'tok')).rejects.toThrow(
      'Connected, but Libby sent no library card yet (result, loans, synchronized). Try Update in a minute.',
    )
    const refused = await libbyLoans(fakeFetch([[401, {}]]), 'old').catch((error: LibbyError) => error)
    expect(refused).toBeInstanceOf(LibbyError)
    expect((refused as LibbyError).status).toBe(401)
  })
})

describe('Libby loans in Borrowed', () => {
  const now = new Date('2026-10-16T12:00:00Z')
  const fromLibby = loansFromSync(SYNC)

  it('adds a new Libby loan with its due date, cover and link', () => {
    const [loan] = mergeLibbyLoans([], fromLibby, now)
    expect(loan).toMatchObject({
      title: 'The Overstory',
      kind: 'ebook',
      libbyId: '1234567',
      cover: 'https://img1.od-cdn.com/ImageType-100/x.jpg',
      renewUrl: 'https://share.libbyapp.com/title/1234567',
      lender: 'Los Angeles Public Library',
    })
    expect(loan.due).toMatch(/^2026-10-3[01]$/)
  })

  it('joins a loan typed in by hand with the same title instead of adding it twice', () => {
    const typed = newLoan({ title: 'the overstory', kind: 'ebook', due: '2026-10-20' }, now)
    const merged = mergeLibbyLoans([typed], fromLibby, now)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: typed.id, libbyId: '1234567' })
  })

  it('follows a renewal, and marks a loan returned once Libby no longer has it', () => {
    const [loan] = mergeLibbyLoans([], fromLibby, now)
    const renewed = mergeLibbyLoans([loan], [{ ...fromLibby[0], due: '2026-11-20T14:00:00Z' }], now)
    expect(renewed[0].due).toMatch(/^2026-11-2[01]$/)
    const gone = mergeLibbyLoans(renewed, [], now)
    expect(gone[0].returnedAt).toBe(now.toISOString())
  })

  it('leaves paper copies and loans from elsewhere alone', () => {
    const paper: Loan = newLoan({ title: 'The Overstory', kind: 'physical', due: '2026-10-25' }, now)
    const merged = mergeLibbyLoans([paper], [], now)
    expect(merged).toEqual([paper])
    expect(mergeLibbyLoans([paper], fromLibby, now)).toHaveLength(2)
  })

  it('asks Libby again at most every 15 minutes, and not while it wants a new code', () => {
    const at = Date.parse('2026-10-16T12:00:00Z')
    expect(libbyDue(null, at)).toBe(false)
    expect(libbyDue({ token: 't', connected: '' }, at)).toBe(true)
    expect(libbyDue({ token: 't', connected: '', checked: '2026-10-16T11:50:00Z' }, at)).toBe(false)
    expect(libbyDue({ token: 't', connected: '', checked: '2026-10-16T11:40:00Z' }, at)).toBe(true)
    expect(libbyDue({ token: 't', connected: '', problem: 'again' }, at)).toBe(false)
  })
})
