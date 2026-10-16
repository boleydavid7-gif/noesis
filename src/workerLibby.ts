// The bridge to Libby's own service, the way Libby's "Copy To Another Device" adds a device: Noesis becomes one more
// device on the reader's Libby, then reads its loans. Libby offers no public API, so this follows the requests the
// open-source Libby tools use (odmpy, the Calibre Libby plugin); it can stop working if Libby changes them.
// Nothing is kept here: the device holds its own Libby token and sends it with each request.

// Libby's service lives at a new address; the older one is tried when the new one does not answer.
export const LIBBY_HOSTS = ['https://sentry.libbyapp.com', 'https://sentry-read.svc.overdrive.com']
// Libby's service answers its own web app; requests are made to look like it.
const HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  origin: 'https://libbyapp.com',
  referer: 'https://libbyapp.com/',
}

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
  read?: string // opens the loan in Libby's reader
  link: string
}

export class LibbyError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Step = 'starting' | 'joining' | 'finishing' | 'checking' | 'loans'

async function call(
  fetcher: Fetcher,
  host: string,
  path: string,
  step: Step,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { ...HEADERS }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json; charset=UTF-8'
  let response: Response
  try {
    response = await fetcher(`${host}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new LibbyError(`Libby did not answer (${step}, no reply).`, 502)
  }
  // A refused token on the loans step means the device was removed from Libby; earlier, a refusal is Libby
  // turning the request away.
  if (step === 'loans' && (response.status === 401 || response.status === 403))
    throw new LibbyError('Libby asked to connect again.', 401)
  if (
    (step === 'joining' && (response.status === 400 || response.status === 404)) ||
    (step === 'checking' && (response.status === 401 || response.status === 403))
  )
    throw new LibbyError('That code did not work. Codes last about a minute; make a new one.', 400)
  if (!response.ok) throw new LibbyError(`Libby did not answer (${step}, ${response.status}).`, 502)
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    throw new LibbyError(`Libby did not answer (${step}, not JSON).`, 502)
  }
}

const identity = (chip: Record<string, unknown>, step: Step) => {
  const token = chip.identity
  if (typeof token !== 'string' || !token) throw new LibbyError(`Libby did not answer (${step}, no token).`, 502)
  return token
}

/**
 * Joins this device to the reader's Libby with the 8-digit code from Copy To Another Device. Returns the token and
 * the address that answered, which later requests use.
 */
export async function connectLibby(
  fetcher: Fetcher,
  code: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<{ token: string; host: string }> {
  if (!/^\d{8}$/.test(code)) throw new LibbyError('Enter the 8-digit code from Libby.', 400)
  let first = ''
  let host = ''
  let problem: unknown
  for (const each of LIBBY_HOSTS) {
    try {
      first = identity(await call(fetcher, each, '/chip?client=dewey', 'starting', { method: 'POST' }), 'starting')
      host = each
      break
    } catch (error) {
      problem = error
    }
  }
  if (!host) throw problem
  const cloned = await call(fetcher, host, '/chip/clone/code', 'joining', {
    method: 'POST',
    token: first,
    body: { code },
  })
  const said = typeof cloned.result === 'string' ? cloned.result.slice(0, 60) : ''
  // The token changes once the device is joined.
  const token = identity(
    await call(fetcher, host, '/chip?client=dewey', 'finishing', { method: 'POST', token: first }),
    'finishing',
  )
  // The device counts as joined once a library card shows up (it can take a moment to arrive).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await wait(1_500)
    const synced = await call(fetcher, host, '/chip/sync', 'checking', { token })
    if (Array.isArray(synced.cards) && synced.cards.length) return { token, host }
  }
  // Libby took the code, but the Libby that made it has no library card: a code from a signed-out Libby.
  if (said === 'cloned' || said === 'success')
    throw new LibbyError(
      'That Libby has no library card. Make the code in the Libby you are signed in to: Menu › Copy To Another Device › Sonos Speakers.',
      400,
    )
  throw new LibbyError(
    `That code did not work. Codes last about a minute; make a new one.${said ? ` Libby said: ${said}.` : ''}`,
    400,
  )
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
        read: /^\d+$/.test(String(loan.cardId ?? ''))
          ? `https://libbyapp.com/open/loan/${String(loan.cardId)}/${id}`
          : undefined,
      },
    ]
  })
}

export async function libbyLoans(fetcher: Fetcher, token: string, host = LIBBY_HOSTS[0]): Promise<LibbyLoan[]> {
  if (!token || token.length > 4_000) throw new LibbyError('Libby asked to connect again.', 401)
  if (!LIBBY_HOSTS.includes(host)) host = LIBBY_HOSTS[0]
  const synced = await call(fetcher, host, '/chip/sync', 'loans', { token })
  // Joined, but Libby has not given this device the library card: say what came back, so it can be looked into.
  if (!Array.isArray(synced.cards) || synced.cards.length === 0) {
    const keys = Object.keys(synced).slice(0, 8).join(', ') || 'nothing'
    const result = typeof synced.result === 'string' ? `, ${synced.result.slice(0, 40)}` : ''
    throw new LibbyError(
      `Connected, but Libby sent no library card yet (${keys}${result}). Try Update in a minute.`,
      502,
    )
  }
  return loansFromSync(synced)
}
