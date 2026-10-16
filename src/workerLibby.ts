// The bridge to Libby's own service, the way Libby's "Copy To Another Device" adds a device: Noesis becomes one more
// device on the reader's Libby, then reads its loans. Libby offers no public API, so this follows the requests the
// open-source Libby tools use (odmpy, the Calibre Libby plugin); it can stop working if Libby changes them.
// Nothing is kept here: the device holds its own Libby token and sends it with each request.

const SENTRY = 'https://sentry-read.svc.overdrive.com'
const AGENT = 'Mozilla/5.0 (Noesis reading app)'

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export type LibbyLoan = {
  id: string
  title: string
  author?: string
  kind: 'ebook' | 'audiobook'
  due: string // ISO time Libby gives as the end of the loan
  borrowed?: string
  cover?: string
  library?: string
  libraryKey?: string
  link: string
}

export class LibbyError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call(
  fetcher: Fetcher,
  path: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': AGENT }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetcher(`${SENTRY}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 401 || response.status === 403) throw new LibbyError('Libby asked to connect again.', 401)
  if (!response.ok) throw new LibbyError('Libby did not answer. Try again later.', 502)
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    throw new LibbyError('Libby did not answer. Try again later.', 502)
  }
}

const identity = (chip: Record<string, unknown>) => {
  const token = chip.identity
  if (typeof token !== 'string' || !token) throw new LibbyError('Libby did not answer. Try again later.', 502)
  return token
}

/** Joins this device to the reader's Libby with the 8-digit code from Copy To Another Device. Returns the token. */
export async function connectLibby(fetcher: Fetcher, code: string): Promise<string> {
  if (!/^\d{8}$/.test(code)) throw new LibbyError('Enter the 8-digit code from Libby.', 400)
  const first = identity(await call(fetcher, '/chip?client=dewey', { method: 'POST' }))
  const cloned = await call(fetcher, '/chip/clone/code', { method: 'POST', token: first, body: { code } })
  if (typeof cloned.result === 'string' && cloned.result !== 'success')
    throw new LibbyError('That code did not work. Codes last about a minute; make a new one.', 400)
  // The token changes once the device is joined.
  return identity(await call(fetcher, '/chip?client=dewey', { method: 'POST', token: first }))
}

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const record = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : ({} as Record<string, unknown>)

function coverOf(loan: Record<string, unknown>): string | undefined {
  const covers = record(loan.covers)
  for (const size of ['cover300Wide', 'cover510Wide', 'cover150Wide']) {
    const href = text(record(covers[size]).href, 600)
    if (/^https:\/\//.test(href)) return href
  }
  return undefined
}

/** The reader's loans from a Libby sync, trimmed to what Noesis shows. Magazines and odd rows are left out. */
export function loansFromSync(sync: Record<string, unknown>): LibbyLoan[] {
  const cards = (Array.isArray(sync.cards) ? sync.cards : []).map(record)
  const cardFor = (id: unknown) => cards.find((card) => String(card.cardId) === String(id))
  return (Array.isArray(sync.loans) ? sync.loans : []).map(record).flatMap((loan): LibbyLoan[] => {
    const id = text(loan.id, 40)
    const title = text(loan.title)
    const kind = text(record(loan.type).id)
    const due = text(loan.expireDate, 40)
    if (!/^\d+$/.test(id) || !title || (kind !== 'ebook' && kind !== 'audiobook') || Number.isNaN(Date.parse(due)))
      return []
    const card = cardFor(loan.cardId)
    const library = text(record(card?.library).name) || text(card?.cardName) || undefined
    const libraryKey = text(card?.advantageKey, 60) || undefined
    return [
      {
        id,
        title,
        author: text(loan.firstCreatorName) || undefined,
        kind,
        due,
        borrowed: text(loan.checkoutDate, 40) || undefined,
        cover: coverOf(loan),
        library,
        libraryKey,
        link: `https://share.libbyapp.com/title/${id}`,
      },
    ]
  })
}

export async function libbyLoans(fetcher: Fetcher, token: string): Promise<LibbyLoan[]> {
  if (!token || token.length > 4_000) throw new LibbyError('Libby asked to connect again.', 401)
  return loansFromSync(await call(fetcher, '/chip/sync', { token }))
}
