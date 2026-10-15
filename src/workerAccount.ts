// The Worker's account helpers that need the Supabase service role (a Worker secret, never in the app):
// signing in with a passkey, and sending review reminders on a schedule.

import { checkAssertion, fromBase64Url } from './lib/webauthn'
import { vapidAuthorization, vapidKey } from './lib/vapid'

export type AccountEnv = {
  VITE_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

function admin(env: AccountEnv) {
  const base = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!base || !key) return null
  return (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
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

function randomChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const refuse = () => reply({ error: 'That passkey did not sign in. Try again, or sign in with your email.' }, 401)

/** POST /api/passkey/begin and /api/passkey/finish. */
export async function handlePasskey(request: Request, env: AccountEnv, step: string): Promise<Response> {
  if (request.method !== 'POST') return reply({ error: 'Not allowed' }, 405)
  const call = admin(env)
  if (!call) return reply({ error: 'Passkeys are not set up on the server yet.' }, 503)

  if (step === 'begin') {
    await call(`/rest/v1/noesis_passkey_challenges?expires_at=lt.${new Date().toISOString()}`, { method: 'DELETE' })
    const challenge = randomChallenge()
    const made = await call('/rest/v1/noesis_passkey_challenges', {
      method: 'POST',
      body: JSON.stringify({ challenge }),
    })
    if (!made.ok) return reply({ error: 'Passkeys are not set up on the server yet.' }, 503)
    return reply({ challenge })
  }
  if (step !== 'finish') return reply({ error: 'Not found' }, 404)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const fields = ['credentialId', 'clientDataJSON', 'authenticatorData', 'signature'] as const
  if (!body || fields.some((field) => typeof body[field] !== 'string' || (body[field] as string).length > 8000)) {
    return reply({ error: 'Bad request' }, 400)
  }
  const [credentialId, clientDataJSON, authenticatorData, signature] = fields.map((field) => body[field] as string)

  let challenge = ''
  try {
    challenge = String(JSON.parse(new TextDecoder().decode(fromBase64Url(clientDataJSON))).challenge ?? '')
  } catch {
    return refuse()
  }
  // The challenge is taken once.
  const taken = await call(
    `/rest/v1/noesis_passkey_challenges?challenge=eq.${encodeURIComponent(challenge)}&expires_at=gte.${new Date().toISOString()}`,
    { method: 'DELETE', headers: { prefer: 'return=representation' } },
  )
  if (!taken.ok || ((await taken.json()) as unknown[]).length === 0) return refuse()

  const found = await call(
    `/rest/v1/noesis_passkeys?credential_id=eq.${encodeURIComponent(credentialId)}&select=user_id,public_key,algorithm,rp_id`,
  )
  const passkey = found.ok
    ? ((await found.json()) as Array<{ user_id: string; public_key: string; algorithm: number; rp_id: string }>)[0]
    : undefined
  if (!passkey) return refuse()
  const problem = await checkAssertion(
    { clientDataJSON, authenticatorData, signature },
    { publicKey: passkey.public_key, algorithm: passkey.algorithm, rpId: passkey.rp_id },
    challenge,
  )
  if (problem) return refuse()

  const user = await call(`/auth/v1/admin/users/${passkey.user_id}`)
  const email = user.ok ? ((await user.json()) as { email?: string }).email : undefined
  if (!email) return refuse()
  // A one-time sign-in for the passkey's owner, made without sending any email; the app exchanges it for a session.
  const link = await call('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const made = link.ok ? ((await link.json()) as { hashed_token?: string; properties?: { hashed_token?: string } }) : {}
  const tokenHash = made.hashed_token ?? made.properties?.hashed_token
  if (!tokenHash) return reply({ error: 'Could not make a sign-in. Try again.' }, 500)
  await call(`/rest/v1/noesis_passkeys?credential_id=eq.${encodeURIComponent(credentialId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  })
  return reply({ token_hash: tokenHash })
}

const DAY_MS = 24 * 60 * 60_000

/**
 * Every 15 minutes (the Worker's cron): an empty push to each device whose next review card has come due, at most
 * once a day. The service worker shows "Review cards are ready."
 */
export async function sendReviewReminders(
  env: AccountEnv,
  now = new Date(),
): Promise<{ sent: number; removed: number }> {
  const call = admin(env)
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  if (!call || !publicKey || !privateKey) return { sent: 0, removed: 0 }
  const key = await vapidKey(publicKey, privateKey)
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:noesis@example.com'
  const due = await call(
    `/rest/v1/noesis_review_push?select=endpoint,last_sent_at,next_review_at&next_review_at=lte.${now.toISOString()}&limit=500`,
  )
  if (!due.ok) return { sent: 0, removed: 0 }
  const rows = (await due.json()) as Array<{ endpoint: string; last_sent_at: string | null; next_review_at: string }>
  let sent = 0
  let removed = 0
  for (const row of rows) {
    if (row.last_sent_at && now.getTime() - Date.parse(row.last_sent_at) < DAY_MS - 60 * 60_000) continue
    if (row.last_sent_at && Date.parse(row.last_sent_at) >= Date.parse(row.next_review_at)) continue
    const where = `/rest/v1/noesis_review_push?endpoint=eq.${encodeURIComponent(row.endpoint)}`
    try {
      const response = await fetch(row.endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidAuthorization(row.endpoint, key, publicKey, subject, now.getTime()),
          ttl: '43200',
          urgency: 'normal',
          'content-length': '0',
        },
      })
      if (response.status === 404 || response.status === 410) {
        await call(where, { method: 'DELETE' })
        removed += 1
        continue
      }
      if (response.ok) {
        await call(where, { method: 'PATCH', body: JSON.stringify({ last_sent_at: now.toISOString() }) })
        sent += 1
      }
    } catch {
      // Tried again on the next run.
    }
  }
  return { sent, removed }
}
