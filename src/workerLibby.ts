// The bridge to Libby's own service, the way Libby's "Copy To Another Device" adds a device: Noesis becomes a new
// Libby device, shows Libby's code, and once the reader enters it in their signed-in Libby, reads the loans. Libby offers no public API, so this follows the requests the
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
  link: string
}

export class LibbyError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Step = 'starting' | 'code' | 'checking' | 'loans'

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
 * Starts joining: Noesis becomes a new Libby device and asks Libby for a code to show. The reader enters it in
 * their signed-in Libby (Menu › Copy To Another Device), which copies their library cards to this device.
 */
export async function startLibbyCode(fetcher: Fetcher): Promise<{ token: string; host: string; code: string }> {
  let token = ''
  let host = ''
  let problem: unknown
  for (const each of LIBBY_HOSTS) {
    try {
      token = identity(await call(fetcher, each, '/chip?client=dewey', 'starting', { method: 'POST' }), 'starting')
      host = each
      break
    } catch (error) {
      problem = error
    }
  }
  if (!host) throw problem
  const made = await call(fetcher, host, '/chip/clone/code', 'code', { token })
  const code = String(made.code ?? '').replace(/\D/g, '')
  if (code.length < 6 || code.length > 10) {
    const keys = Object.keys(made).slice(0, 8).join(', ') || 'nothing'
    throw new LibbyError(`Libby did not answer (code, sent ${keys}).`, 502)
  }
  return { token, host, code }
}

/**
 * Whether the reader's Libby has copied its cards over yet. The token is refreshed each time (it changes once the
 * device holds the cards); `joined` turns true when a library card shows up.
 */
export async function checkLibbyCode(
  fetcher: Fetcher,
  token: string,
  host: string,
): Promise<{ joined: boolean; token: string }> {
  if (!token || token.length > 4_000) throw new LibbyError('Get a new code.', 400)
  if (!LIBBY_HOSTS.includes(host)) host = LIBBY_HOSTS[0]
  const fresh = identity(
    await call(fetcher, host, '/chip?client=dewey', 'checking', { method: 'POST', token }),
    'checking',
  )
  const synced = await call(fetcher, host, '/chip/sync', 'checking', { token: fresh })
  return { joined: Array.isArray(synced.cards) && synced.cards.length > 0, token: fresh }
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
