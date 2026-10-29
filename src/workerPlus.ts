// Noesis Plus and Noema's monthly allowance (migration 20261029000000_noesis_plus.sql).
//
// Everyone signed in may ask Noema NOEMA_FREE times a month; Noesis Plus ($5.99 a month or $49.99 a year, the first
// 7 days free) raises that to NOEMA_PLUS. Every AI route counts one use (guardAi in worker.ts calls takeNoema). The
// subscription is Stripe's: checkout and the billing portal open on Stripe, and its webhook writes noesis_plus with
// the service role. Without the Stripe secrets nothing can be bought; without the migration nothing is counted, so
// Noema keeps working until the server has it.

export type PlusEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export const PLANS = {
  month: { cents: 599, label: '$5.99', interval: 'month' },
  year: { cents: 4999, label: '$49.99', interval: 'year' },
} as const
export type PlanId = keyof typeof PLANS
export const TRIAL_DAYS = 7
export const NOEMA_FREE = 15
export const NOEMA_PLUS = 300

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** The month the allowance counts in, by the calendar in UTC: "2026-10". */
export function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/** The first day of the next month, when the allowance comes back. */
export function nextMonthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

export function paymentsReady(env: PlusEnv): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY?.trim() &&
    env.STRIPE_WEBHOOK_SECRET?.trim() &&
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
    env.VITE_SUPABASE_URL?.trim(),
  )
}

function admin(env: PlusEnv, fetcher: Fetcher) {
  const base = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!base || !key) return null
  return (path: string, init: RequestInit = {}) =>
    fetcher(`${base}${path}`, {
      ...init,
      headers: {
        apikey: key,
        // A newer secret key (sb_secret_…) goes only in apikey; the older service_role key is a JWT and goes in both.
        ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
}

export type Person = { id: string; email?: string; anonymous?: boolean }

/** The signed-in person behind a request's Bearer token, or null. */
export async function personFrom(request: Request, env: PlusEnv, fetcher: Fetcher = fetch): Promise<Person | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const base = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!token || !base || !key) return null
  try {
    const response = await fetcher(`${base}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: key },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const user = (await response.json()) as { id?: string; email?: string; is_anonymous?: boolean }
    return user.id ? { id: user.id, email: user.email, anonymous: Boolean(user.is_anonymous) } : null
  } catch {
    return null
  }
}

export type PlusRow = {
  status: string
  plan: PlanId | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  stripe_customer: string | null
  stripe_subscription: string | null
}

/** Active while Stripe calls it active or in its trial, and its period has not ended (a day's grace for renewals). */
export function isActive(row: Pick<PlusRow, 'status' | 'current_period_end'> | null, now = Date.now()): boolean {
  if (!row || !['active', 'trialing', 'past_due'].includes(row.status)) return false
  if (!row.current_period_end) return true
  return Date.parse(row.current_period_end) + 86_400_000 > now
}

async function plusRow(env: PlusEnv, fetcher: Fetcher, user: string): Promise<PlusRow | null | undefined> {
  const call = admin(env, fetcher)
  if (!call) return undefined
  try {
    const response = await call(
      `/rest/v1/noesis_plus?user_id=eq.${encodeURIComponent(user)}&select=status,plan,current_period_end,cancel_at_period_end,stripe_customer,stripe_subscription`,
    )
    if (!response.ok) return undefined
    const rows = (await response.json()) as PlusRow[]
    return rows[0] ?? null
  } catch {
    return undefined
  }
}

async function usedThisMonth(env: PlusEnv, fetcher: Fetcher, user: string, now: Date): Promise<number | undefined> {
  const call = admin(env, fetcher)
  if (!call) return undefined
  try {
    const response = await call(
      `/rest/v1/noesis_noema_use?user_id=eq.${encodeURIComponent(user)}&month=eq.${monthKey(now)}&select=used`,
    )
    if (!response.ok) return undefined
    const rows = (await response.json()) as Array<{ used: number }>
    return rows[0]?.used ?? 0
  } catch {
    return undefined
  }
}

/**
 * Counts one use of Noema for this person, or answers 402 when the month's allowance is used. Returns null to go
 * ahead. Nothing is counted (and Noema is not held back) when the server has no service role or no migration yet.
 */
export async function takeNoema(
  env: PlusEnv,
  person: Person | null,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<Response | null> {
  if (!person) return null
  const call = admin(env, fetcher)
  if (!call) return null
  const row = await plusRow(env, fetcher, person.id)
  const plus = isActive(row ?? null, now.getTime())
  const limit = plus ? NOEMA_PLUS : NOEMA_FREE
  try {
    const response = await call('/rest/v1/rpc/noesis_take_noema', {
      method: 'POST',
      body: JSON.stringify({ p_user: person.id, p_month: monthKey(now), p_limit: limit }),
    })
    if (!response.ok) return null
    const used = (await response.json()) as number | null
    if (typeof used === 'number') return null
  } catch {
    return null
  }
  const back = new Date(nextMonthStart(now)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return reply(
    {
      ok: false,
      error: plus
        ? `That's this month's ${NOEMA_PLUS} Noema questions. More from ${back}.`
        : `That's this month's ${NOEMA_FREE} free Noema questions. Noesis Plus has ${NOEMA_PLUS} a month.`,
      noema: { used: limit, limit, plus, resets: nextMonthStart(now) },
    },
    402,
  )
}

/** GET /api/plus: prices, whether payments are open, and (signed in) the person's plan and this month's use. */
async function status(request: Request, env: PlusEnv, fetcher: Fetcher): Promise<Response> {
  const now = new Date()
  const base = {
    payments: paymentsReady(env),
    trialDays: TRIAL_DAYS,
    prices: { month: PLANS.month.label, year: PLANS.year.label },
    free: NOEMA_FREE,
    included: NOEMA_PLUS,
  }
  const person = await personFrom(request, env, fetcher)
  if (!person) return reply({ ...base, signedIn: false })
  const row = await plusRow(env, fetcher, person.id)
  const plus = isActive(row ?? null, now.getTime())
  const used = await usedThisMonth(env, fetcher, person.id, now)
  return reply({
    ...base,
    signedIn: !person.anonymous,
    plus: plus
      ? {
          plan: row?.plan ?? null,
          status: row?.status,
          renews: row?.current_period_end ?? null,
          endsAtPeriodEnd: Boolean(row?.cancel_at_period_end),
        }
      : null,
    // Undefined when the server is not counting yet.
    noema: used === undefined ? null : { used, limit: plus ? NOEMA_PLUS : NOEMA_FREE, resets: nextMonthStart(now) },
  })
}

function stripe(env: PlusEnv, fetcher: Fetcher, path: string, form?: URLSearchParams) {
  return fetcher(`https://api.stripe.com/v1/${path}`, {
    method: form ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY?.trim()}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form,
  })
}

/**
 * The mark on Noesis's own checkouts and subscriptions. The Stripe account may also take the Proairetos Store's
 * payments, and Stripe sends every endpoint every event, so the webhook acts only on events carrying this mark.
 */
export const PLUS_APP = 'noesis-plus'

/** POST /api/plus/checkout {plan}: a Stripe Checkout page for a subscription, the first 7 days free once. */
async function checkout(request: Request, env: PlusEnv, fetcher: Fetcher): Promise<Response> {
  if (!paymentsReady(env)) return reply({ error: 'Noesis Plus is not open yet.' }, 503)
  const body = (await request.json().catch(() => ({}))) as { plan?: string }
  const plan = body.plan === 'month' || body.plan === 'year' ? body.plan : null
  if (!plan) return reply({ error: 'Choose monthly or yearly.' }, 400)
  const person = await personFrom(request, env, fetcher)
  if (!person || person.anonymous) return reply({ error: 'Sign in to start Noesis Plus.' }, 401)
  const row = await plusRow(env, fetcher, person.id)
  if (isActive(row ?? null)) return reply({ already: true })
  const origin = new URL(request.url).origin
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(PLANS[plan].cents),
    'line_items[0][price_data][recurring][interval]': PLANS[plan].interval,
    'line_items[0][price_data][product_data][name]': 'Noesis Plus',
    client_reference_id: person.id,
    'metadata[app]': PLUS_APP,
    'metadata[user]': person.id,
    'metadata[plan]': plan,
    'subscription_data[metadata][app]': PLUS_APP,
    'subscription_data[metadata][user]': person.id,
    'subscription_data[metadata][plan]': plan,
    allow_promotion_codes: 'true',
    success_url: `${origin}/?plus=started`,
    cancel_url: `${origin}/?plus=canceled`,
  })
  // The free week is for a first subscription only.
  if (!row) form.set('subscription_data[trial_period_days]', String(TRIAL_DAYS))
  if (row?.stripe_customer) form.set('customer', row.stripe_customer)
  else if (person.email) form.set('customer_email', person.email)
  const response = await stripe(env, fetcher, 'checkout/sessions', form)
  const session = (await response.json().catch(() => ({}))) as { url?: string }
  if (!response.ok || !session.url)
    return reply({ error: 'The payment page did not open. Try again in a minute.' }, 502)
  return reply({ url: session.url })
}

/** POST /api/plus/portal: Stripe's page to change the plan, the card or cancel. */
async function portal(request: Request, env: PlusEnv, fetcher: Fetcher): Promise<Response> {
  if (!paymentsReady(env)) return reply({ error: 'Noesis Plus is not open yet.' }, 503)
  const person = await personFrom(request, env, fetcher)
  if (!person) return reply({ error: 'Sign in first.' }, 401)
  const row = await plusRow(env, fetcher, person.id)
  if (!row?.stripe_customer) return reply({ error: 'There is no subscription on this account.' }, 404)
  const form = new URLSearchParams({
    customer: row.stripe_customer,
    return_url: `${new URL(request.url).origin}/?plus=manage`,
  })
  const response = await stripe(env, fetcher, 'billing_portal/sessions', form)
  const session = (await response.json().catch(() => ({}))) as { url?: string }
  if (!response.ok || !session.url)
    return reply({ error: 'The subscription page did not open. Try again in a minute.' }, 502)
  return reply({ url: session.url })
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** Stripe's signature: HMAC-SHA256 of "t.body" with the webhook secret, within five minutes. */
export async function stripeSigned(
  payload: string,
  header: string | null,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!header) return false
  const parts = header.split(',').map((part) => part.trim().split('='))
  const time = Number(parts.find(([key]) => key === 't')?.[1])
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value)
  if (!time || !signatures.length || Math.abs(now / 1000 - time) > 300) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${payload}`)))
  return signatures.some((signature) => signature === expected)
}

type Subscription = {
  id?: string
  status?: string
  customer?: string
  cancel_at_period_end?: boolean
  current_period_end?: number
  metadata?: { app?: string; user?: string; plan?: string }
  items?: { data?: Array<{ current_period_end?: number; price?: { recurring?: { interval?: string } } }> }
}

/** The row a Stripe subscription makes for its person. */
export function rowFrom(subscription: Subscription, user: string) {
  const item = subscription.items?.data?.[0]
  const interval = item?.price?.recurring?.interval ?? subscription.metadata?.plan
  // Newer Stripe versions keep the period on the item rather than on the subscription.
  const end = subscription.current_period_end ?? item?.current_period_end
  return {
    user_id: user,
    status: String(subscription.status ?? 'incomplete'),
    plan: interval === 'year' ? 'year' : interval === 'month' ? 'month' : null,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    stripe_customer: subscription.customer ?? null,
    stripe_subscription: subscription.id ?? null,
    updated_at: new Date().toISOString(),
  }
}

/** POST /api/plus/webhook: Stripe tells the Worker about a checkout or a subscription that changed. */
async function webhook(request: Request, env: PlusEnv, fetcher: Fetcher): Promise<Response> {
  if (!paymentsReady(env)) return reply({ error: 'Not set up.' }, 503)
  const payload = await request.text()
  if (!(await stripeSigned(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET!.trim())))
    return reply({ error: 'Bad signature.' }, 400)
  const event = JSON.parse(payload) as { type?: string; data?: { object?: Record<string, unknown> } }
  const object = event.data?.object ?? {}
  let subscription: Subscription | null = null
  let user: string | undefined
  if (event.type === 'checkout.session.completed') {
    const session = object as {
      subscription?: string
      client_reference_id?: string
      metadata?: { app?: string; user?: string }
    }
    if (session.metadata?.app !== PLUS_APP) return reply({ ignored: true })
    user = session.client_reference_id ?? session.metadata?.user
    if (session.subscription) {
      const response = await stripe(env, fetcher, `subscriptions/${encodeURIComponent(session.subscription)}`)
      if (!response.ok) return reply({ error: 'Could not read the subscription.' }, 502)
      subscription = (await response.json()) as Subscription
    }
  } else if (event.type?.startsWith('customer.subscription.')) {
    subscription = object as Subscription
    user = subscription.metadata?.user
  } else {
    return reply({ ignored: true })
  }
  // Another app's subscription on the same Stripe account is never Noesis Plus.
  if (!subscription || !user || subscription.metadata?.app !== PLUS_APP) return reply({ ignored: true })
  const call = admin(env, fetcher)!
  const saved = await call('/rest/v1/noesis_plus?on_conflict=user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rowFrom(subscription, user)),
  })
  // A failure makes Stripe send it again later.
  if (!saved.ok) return reply({ error: 'Could not save.' }, 500)
  return reply({ saved: true })
}

/** Routes under /api/plus. */
export async function handlePlus(
  request: Request,
  env: PlusEnv,
  step: string,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  if (step === '' && request.method === 'GET') return status(request, env, fetcher)
  if (request.method !== 'POST') return reply({ error: 'Not allowed' }, 405)
  if (step === 'checkout') return checkout(request, env, fetcher)
  if (step === 'portal') return portal(request, env, fetcher)
  if (step === 'webhook') return webhook(request, env, fetcher)
  return reply({ error: 'Not found' }, 404)
}
