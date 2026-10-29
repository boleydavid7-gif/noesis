import { describe, expect, it, vi } from 'vitest'
import {
  NOEMA_FREE,
  NOEMA_PLUS,
  handlePlus,
  isActive,
  monthKey,
  nextMonthStart,
  rowFrom,
  stripeSigned,
  takeNoema,
} from '../workerPlus'

const env = {
  VITE_SUPABASE_URL: 'https://db.test',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'pub',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
}
const person = { id: 'u1', email: 'a@b.c' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

// A stand-in for Supabase and Stripe: answers by address, and keeps what was sent.
function server(options: { plus?: unknown[]; taken?: number | null; used?: number; user?: unknown } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.endsWith('/auth/v1/user')) return options.user === null ? json({}, 401) : json(options.user ?? person)
    if (url.includes('/rest/v1/noesis_plus?user_id')) return json(options.plus ?? [])
    if (url.includes('/rest/v1/noesis_noema_use'))
      return json(options.used === undefined ? [] : [{ used: options.used }])
    if (url.includes('/rpc/noesis_take_noema')) return json(options.taken === undefined ? 1 : options.taken)
    if (url.includes('/rest/v1/noesis_plus?on_conflict')) return new Response(null, { status: 201 })
    if (url.includes('checkout/sessions')) return json({ url: 'https://checkout.stripe.test/s' })
    if (url.includes('billing_portal')) return json({ url: 'https://billing.stripe.test/p' })
    if (url.includes('/v1/subscriptions/'))
      return json({
        id: 'sub_1',
        status: 'trialing',
        customer: 'cus_1',
        current_period_end: 1_800_000_000,
        metadata: { user: 'u1', plan: 'year' },
        items: { data: [{ price: { recurring: { interval: 'year' } } }] },
      })
    return json({}, 404)
  })
  return { fetcher, calls }
}

const signed = async (payload: string, secret = 'whsec', time = Math.floor(Date.now() / 1000)) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${payload}`))
  return `t=${time},v1=${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

describe("Noema's monthly allowance", () => {
  it('counts nothing for a request with no person, or a server without the service role', async () => {
    const { fetcher } = server()
    expect(await takeNoema(env, null, fetcher)).toBeNull()
    expect(await takeNoema({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, person, fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('takes one use at the free limit, and goes ahead while there is room', async () => {
    const { fetcher, calls } = server({ taken: 3 })
    expect(await takeNoema(env, person, fetcher, new Date('2026-10-29T12:00:00Z'))).toBeNull()
    const rpc = calls.find((each) => each.url.includes('noesis_take_noema'))!
    expect(JSON.parse(String(rpc.init?.body))).toEqual({ p_user: 'u1', p_month: '2026-10', p_limit: NOEMA_FREE })
  })

  it('answers 402 with the facts once the free questions are used', async () => {
    const { fetcher } = server({ taken: null })
    const response = (await takeNoema(env, person, fetcher, new Date('2026-10-29T12:00:00Z')))!
    expect(response.status).toBe(402)
    const body = (await response.json()) as { error: string; noema: { limit: number; plus: boolean; resets: string } }
    expect(body.error).toBe(
      `That's this month's ${NOEMA_FREE} free Noema questions. Noesis Plus has ${NOEMA_PLUS} a month.`,
    )
    expect(body.noema).toMatchObject({ limit: NOEMA_FREE, plus: false, resets: '2026-11-01T00:00:00.000Z' })
  })

  it('gives Noesis Plus its larger allowance, and says when it comes back', async () => {
    const plus = [
      { status: 'active', plan: 'month', current_period_end: '2026-11-20T00:00:00Z', cancel_at_period_end: false },
    ]
    const { fetcher, calls } = server({ plus, taken: null })
    const response = (await takeNoema(env, person, fetcher, new Date('2026-10-29T12:00:00Z')))!
    const rpc = calls.find((each) => each.url.includes('noesis_take_noema'))!
    expect(JSON.parse(String(rpc.init?.body)).p_limit).toBe(NOEMA_PLUS)
    expect(((await response.json()) as { error: string }).error).toBe(
      `That's this month's ${NOEMA_PLUS} Noema questions. More from Nov 1.`,
    )
  })

  it('keeps Noema working when the server has no migration yet', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('rpc') ? json({ message: 'missing' }, 404) : json([])))
    expect(await takeNoema(env, person, fetcher)).toBeNull()
  })

  it('reads the month and the next one in UTC', () => {
    expect(monthKey(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12')
    expect(nextMonthStart(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('Noesis Plus', () => {
  it('is active while Stripe says active, trialing or past due, until a day after the period ends', () => {
    const now = Date.parse('2026-10-29T00:00:00Z')
    expect(isActive({ status: 'trialing', current_period_end: '2026-11-05T00:00:00Z' }, now)).toBe(true)
    expect(isActive({ status: 'past_due', current_period_end: '2026-10-28T12:00:00Z' }, now)).toBe(true)
    expect(isActive({ status: 'active', current_period_end: '2026-10-27T00:00:00Z' }, now)).toBe(false)
    expect(isActive({ status: 'canceled', current_period_end: '2026-12-01T00:00:00Z' }, now)).toBe(false)
    expect(isActive(null, now)).toBe(false)
  })

  it('shows prices to anyone, and the plan and use to the person signed in', async () => {
    const { fetcher } = server({ used: 4 })
    const out = await handlePlus(new Request('https://noesis.test/api/plus'), {}, '', fetcher)
    expect(await out.json()).toMatchObject({
      payments: false,
      signedIn: false,
      prices: { month: '$5.99', year: '$49.99' },
    })
    const mine = await handlePlus(
      new Request('https://noesis.test/api/plus', { headers: { authorization: 'Bearer t' } }),
      env,
      '',
      fetcher,
    )
    expect(await mine.json()).toMatchObject({
      payments: true,
      signedIn: true,
      plus: null,
      noema: { used: 4, limit: NOEMA_FREE },
    })
  })

  it('opens a subscription checkout with the free week the first time', async () => {
    const { fetcher, calls } = server()
    const response = await handlePlus(
      new Request('https://noesis.test/api/plus/checkout', {
        method: 'POST',
        headers: { authorization: 'Bearer t' },
        body: JSON.stringify({ plan: 'year' }),
      }),
      env,
      'checkout',
      fetcher,
    )
    expect(await response.json()).toEqual({ url: 'https://checkout.stripe.test/s' })
    const form = new URLSearchParams(String(calls.find((each) => each.url.includes('checkout/sessions'))!.init?.body))
    expect(form.get('mode')).toBe('subscription')
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('4999')
    expect(form.get('line_items[0][price_data][recurring][interval]')).toBe('year')
    expect(form.get('subscription_data[trial_period_days]')).toBe('7')
    expect(form.get('subscription_data[metadata][user]')).toBe('u1')
    expect(form.get('customer_email')).toBe('a@b.c')
  })

  it('gives no second free week, and reuses the Stripe customer', async () => {
    const plus = [
      {
        status: 'canceled',
        plan: 'month',
        current_period_end: '2026-01-01T00:00:00Z',
        cancel_at_period_end: false,
        stripe_customer: 'cus_9',
      },
    ]
    const { fetcher, calls } = server({ plus })
    await handlePlus(
      new Request('https://noesis.test/api/plus/checkout', {
        method: 'POST',
        headers: { authorization: 'Bearer t' },
        body: JSON.stringify({ plan: 'month' }),
      }),
      env,
      'checkout',
      fetcher,
    )
    const form = new URLSearchParams(String(calls.find((each) => each.url.includes('checkout/sessions'))!.init?.body))
    expect(form.get('subscription_data[trial_period_days]')).toBeNull()
    expect(form.get('customer')).toBe('cus_9')
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('599')
  })

  it('asks for a real account before checkout', async () => {
    for (const user of [null, { id: 'anon', is_anonymous: true }]) {
      const { fetcher } = server({ user })
      const response = await handlePlus(
        new Request('https://noesis.test/api/plus/checkout', {
          method: 'POST',
          headers: { authorization: 'Bearer t' },
          body: JSON.stringify({ plan: 'month' }),
        }),
        env,
        'checkout',
        fetcher,
      )
      expect(response.status).toBe(401)
    }
  })

  it('checks Stripe’s signature and its age', async () => {
    expect(await stripeSigned('{}', await signed('{}'), 'whsec')).toBe(true)
    expect(await stripeSigned('{}', await signed('{}', 'other'), 'whsec')).toBe(false)
    expect(await stripeSigned('{}', await signed('{}', 'whsec', Math.floor(Date.now() / 1000) - 600), 'whsec')).toBe(
      false,
    )
    expect(await stripeSigned('{}', null, 'whsec')).toBe(false)
  })

  it('keeps the plan Stripe reports, from the item when the subscription has no period', () => {
    const row = rowFrom(
      {
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        items: { data: [{ current_period_end: 1_800_000_000, price: { recurring: { interval: 'month' } } }] },
      },
      'u1',
    )
    expect(row).toMatchObject({
      user_id: 'u1',
      status: 'active',
      plan: 'month',
      stripe_customer: 'cus_1',
      current_period_end: new Date(1_800_000_000_000).toISOString(),
    })
  })

  it('writes the subscription a checkout started, and refuses an unsigned webhook', async () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_1', client_reference_id: 'u1' } },
    })
    const { fetcher, calls } = server()
    const bad = await handlePlus(
      new Request('https://noesis.test/api/plus/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': 't=1,v1=00' },
      }),
      env,
      'webhook',
      fetcher,
    )
    expect(bad.status).toBe(400)
    const good = await handlePlus(
      new Request('https://noesis.test/api/plus/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': await signed(payload) },
      }),
      env,
      'webhook',
      fetcher,
    )
    expect(good.status).toBe(200)
    const saved = JSON.parse(String(calls.find((each) => each.url.includes('on_conflict'))!.init?.body))
    expect(saved).toMatchObject({ user_id: 'u1', status: 'trialing', plan: 'year', stripe_subscription: 'sub_1' })
  })
})
