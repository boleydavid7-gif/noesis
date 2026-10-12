// Review reminders with Noesis closed (Web Push). This device's push address and the time its next review card is
// due are kept in the account (table `noesis_review_push`); the Worker sends an empty push when that time comes, at
// most once a day, and the service worker shows "Review cards are ready." Nothing about the cards is sent.

import { getAuthClient, getCurrentSession, isAnonymousUser } from './auth'

let vapid: Promise<string> | null = null
const vapidKey = () =>
  (vapid ??= fetch('/api/config')
    .then((response) => (response.ok ? response.json() : {}))
    .then((config: { vapidPublicKey?: string }) => config.vapidPublicKey ?? '')
    .catch(() => ''))

const toBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

let last = ''

export async function syncReviewPush(on: boolean, nextDue: string | undefined): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof PushManager === 'undefined')
      return
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return
    const existing = await registration.pushManager.getSubscription()
    const client = getAuthClient()
    if (!on) {
      if (existing) {
        await client.from('noesis_review_push').delete().eq('endpoint', existing.endpoint)
        last = ''
      }
      return
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const key = await vapidKey()
    if (!key) return
    const session = await getCurrentSession()
    const user = session?.user
    if (!user || isAnonymousUser(user)) return
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }))
    const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return
    const stamp = `${json.endpoint}|${nextDue ?? ''}|${user.id}`
    if (stamp === last) return
    const { error } = await client.from('noesis_review_push').upsert(
      {
        endpoint: json.endpoint,
        user_id: user.id,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        next_review_at: nextDue ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    if (!error) last = stamp
  } catch {
    // Reminders while Noesis is open still work; this tries again on the next change.
  }
}
