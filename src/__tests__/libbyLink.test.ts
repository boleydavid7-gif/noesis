import { describe, expect, it } from 'vitest'
import { connectLibby, libbyLoans, loansFromSync, LibbyError } from '../workerLibby'
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

  it('joins with the code: a device, the clone, then the joined device token', async () => {
    const calls: Call[] = []
    const fetcher = fakeFetch(
      [
        [200, { identity: 'first' }],
        [200, { result: 'success' }],
        [200, { identity: 'joined' }],
        [200, SYNC],
      ],
      calls,
    )
    await expect(connectLibby(fetcher, '12345678')).resolves.toEqual({
      token: 'joined',
      host: 'https://sentry.libbyapp.com',
    })
    expect(new Headers(calls[0].init?.headers).get('origin')).toBe('https://libbyapp.com')
    expect(calls.map((call) => call.url.replace('https://sentry.libbyapp.com', ''))).toEqual([
      '/chip?client=dewey',
      '/chip/clone/code',
      '/chip?client=dewey',
      '/chip/sync',
    ])
    expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer first')
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ code: '12345678' })
  })

  it('tries the older address when the new one turns the request away, and keeps the one that answered', async () => {
    const calls: Call[] = []
    const fetcher = fakeFetch(
      [
        [403, {}],
        [200, { identity: 'first' }],
        [200, { result: 'success' }],
        [200, { identity: 'joined' }],
        [200, SYNC],
      ],
      calls,
    )
    await expect(connectLibby(fetcher, '12345678')).resolves.toEqual({
      token: 'joined',
      host: 'https://sentry-read.svc.overdrive.com',
    })
    expect(calls[1].url).toBe('https://sentry-read.svc.overdrive.com/chip?client=dewey')
  })

  it('names the step and the answer when Libby does not answer', async () => {
    await expect(
      connectLibby(
        fakeFetch([
          [403, {}],
          [503, {}],
        ]),
        '12345678',
      ),
    ).rejects.toThrow('Libby did not answer (starting, 503).')
  })

  it('counts the device joined when the card shows up, whatever Libby replied to the code', async () => {
    const fetcher = fakeFetch([
      [200, { identity: 'first' }],
      [200, { result: 'cloned' }],
      [200, { identity: 'joined' }],
      [200, SYNC],
    ])
    await expect(connectLibby(fetcher, '12345678')).resolves.toMatchObject({ token: 'joined' })
  })

  it('says plainly when the code is wrong or Libby refuses the token', async () => {
    await expect(connectLibby(fakeFetch([]), '123')).rejects.toThrow('8-digit')
    await expect(
      connectLibby(
        fakeFetch([
          [200, { identity: 'first' }],
          [200, { result: 'invalid_code' }],
          [200, { identity: 'first' }],
          [200, { result: 'synchronized', cards: [] }],
        ]),
        '12345678',
      ),
    ).rejects.toThrow('did not work. Codes last about a minute; make a new one. Libby said: invalid_code.')
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
