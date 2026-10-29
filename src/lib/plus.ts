// Noesis Plus on the device: the person's plan and this month's Noema use, read from /api/plus (workerPlus.ts).
// Screens subscribe with usePlus; refreshPlus runs on start, sign-in, coming back into view and after each Noema use.

import { useSyncExternalStore } from 'react'
import { authHeaders } from './auth'
import { NOEMA_FREE, NOEMA_PLUS, PLANS, TRIAL_DAYS, type PlanId } from '../workerPlus'

export type PlusStatus = {
  payments: boolean
  trialDays: number
  prices: { month: string; year: string }
  free: number
  included: number
  signedIn: boolean
  plus: { plan: PlanId | null; status?: string; renews: string | null; endsAtPeriodEnd: boolean } | null
  noema: { used: number; limit: number; resets: string } | null
}

// What shows before the server answers (or offline): the prices, nothing about the person.
export const FALLBACK: PlusStatus = {
  payments: false,
  trialDays: TRIAL_DAYS,
  prices: { month: PLANS.month.label, year: PLANS.year.label },
  free: NOEMA_FREE,
  included: NOEMA_PLUS,
  signedIn: false,
  plus: null,
  noema: null,
}

let current: PlusStatus = FALLBACK
let started = false
const listeners = new Set<() => void>()

function set(next: PlusStatus) {
  current = next
  for (const listener of listeners) listener()
}

export async function refreshPlus(): Promise<PlusStatus> {
  try {
    const response = await fetch('/api/plus', { headers: await authHeaders(), cache: 'no-store' })
    if (response.ok) set({ ...FALLBACK, ...((await response.json()) as Partial<PlusStatus>) })
  } catch {
    // Offline: keep what was known.
  }
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    void refreshPlus()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshPlus()
    })
  }
  return () => listeners.delete(listener)
}

export function usePlus(): PlusStatus {
  return useSyncExternalStore(subscribe, () => current)
}

/** After a Noema answer (or a refusal), the count shown is read again. */
export function noemaUsed(): void {
  void refreshPlus()
}

async function post(path: string, body?: unknown): Promise<{ url?: string; already?: boolean; error?: string }> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body ?? {}),
    })
    return (await response.json().catch(() => ({}))) as { url?: string; already?: boolean; error?: string }
  } catch {
    return { error: 'Could not reach Noesis. Check your connection and try again.' }
  }
}

/** Opens Stripe's page for the plan; returns a message when it cannot. */
export async function startPlus(plan: PlanId): Promise<string | null> {
  const result = await post('/api/plus/checkout', { plan })
  if (result.url) {
    window.location.assign(result.url)
    return null
  }
  if (result.already) {
    await refreshPlus()
    return 'Noesis Plus is already on for this account.'
  }
  return result.error ?? 'The payment page did not open. Try again in a minute.'
}

/** Opens Stripe's page to change the plan, the card or cancel. */
export async function managePlus(): Promise<string | null> {
  const result = await post('/api/plus/portal')
  if (result.url) {
    window.location.assign(result.url)
    return null
  }
  return result.error ?? 'The subscription page did not open. Try again in a minute.'
}

/** "Nov 29", for renewals and when the allowance comes back. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The yearly plan as a monthly figure: "$4.17". */
export function perMonth(yearLabel: string): string {
  const amount = Number(yearLabel.replace(/[^0-9.]/g, ''))
  return Number.isFinite(amount) && amount > 0 ? `$${(amount / 12).toFixed(2)}` : ''
}
