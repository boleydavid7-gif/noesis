// A connected Libby: this device joins the reader's Libby with a Copy To Another Device code, then Borrowed fills in
// from Libby's own loans (due dates, covers, a link to each book). The Libby token stays on this device; it is
// never synced or backed up. The loans themselves are ordinary loans, so they sync like the rest.
import { localDay, newLoan, returned, type Loan } from './loans'
import type { LibbyLoan } from '../workerLibby'

export const LIBBY_LINK_KEY = 'noesis:libby-link:v1'
const CHANGED = 'noesis-libby-link-changed'
const EVERY = 15 * 60_000

export type LibbyLink = { token: string; host?: string; connected: string; checked?: string; problem?: string }

export type { LibbyLoan }

export function readLibbyLink(storage: Storage | null = typeof window === 'undefined' ? null : localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(LIBBY_LINK_KEY) ?? 'null') as LibbyLink | null
    return value && typeof value.token === 'string' && value.token ? value : null
  } catch {
    return null
  }
}

export function writeLibbyLink(
  link: LibbyLink | null,
  storage: Storage | null = typeof window === 'undefined' ? null : localStorage,
) {
  try {
    if (link) storage?.setItem(LIBBY_LINK_KEY, JSON.stringify(link))
    else storage?.removeItem(LIBBY_LINK_KEY)
  } catch {
    // Storage blocked: the connection lasts for this visit.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

export function onLibbyLinkChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(CHANGED, listener)
  return () => window.removeEventListener(CHANGED, listener)
}

/** Whether it is time to ask Libby again (at most every 15 minutes on its own). */
export const libbyDue = (link: LibbyLink | null, now = Date.now()) =>
  Boolean(link && !link.problem && (!link.checked || now - Date.parse(link.checked) >= EVERY))

async function ask(body: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch('/api/libby', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw Object.assign(new Error('No connection. Try again when you are online.'), { status: 0 })
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok)
    throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Libby did not answer.'), {
      status: response.status,
    })
  return data
}

export async function connectLibby(code: string): Promise<LibbyLink> {
  const data = await ask({ action: 'connect', code: code.replace(/\D/g, '') })
  if (typeof data.token !== 'string') throw new Error('Libby did not answer. Try again later.')
  const link = {
    token: data.token,
    host: typeof data.host === 'string' ? data.host : undefined,
    connected: new Date().toISOString(),
  }
  writeLibbyLink(link)
  return link
}

const day = (iso: string) => localDay(new Date(iso))

/**
 * Libby's loans laid over the reader's: a loan Libby knows is updated (due date, cover, link), a new one is added,
 * an e-book or audiobook typed in by hand with the same title is joined to it, and a loan from Libby that is no
 * longer there is marked returned. Paper copies and other lenders are left alone.
 */
export function mergeLibbyLoans(loans: Loan[], fromLibby: LibbyLoan[], now = new Date()): Loan[] {
  const stamp = now.toISOString()
  const seen = new Set(fromLibby.map((loan) => loan.id))
  const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const next = loans.map((loan) =>
    loan.libbyId && !seen.has(loan.libbyId) && !loan.returnedAt ? returned(loan, now) : loan,
  )
  for (const item of fromLibby) {
    const fields = {
      title: item.title,
      author: item.author,
      kind: item.kind,
      due: day(item.due),
      lender: item.library,
      renewUrl: item.link,
      cover: item.cover,
      libbyId: item.id,
    }
    const at = next.findIndex(
      (loan) =>
        loan.libbyId === item.id ||
        (!loan.libbyId && !loan.returnedAt && loan.kind !== 'physical' && sameTitle(loan.title, item.title)),
    )
    if (at < 0) {
      next.push(newLoan(fields, now))
      continue
    }
    const before = next[at]
    const changed =
      before.due !== fields.due ||
      before.cover !== fields.cover ||
      before.renewUrl !== fields.renewUrl ||
      before.libbyId !== fields.libbyId ||
      Boolean(before.returnedAt)
    if (changed)
      next[at] = {
        ...before,
        ...fields,
        author: before.author ?? fields.author,
        lender: fields.lender ?? before.lender,
        returnedAt: undefined,
        updated: stamp,
      }
  }
  return next
}

/** Asks Libby for the loans. A token Libby no longer accepts leaves the connection marked, to connect again. */
export async function refreshFromLibby(
  loans: Loan[],
  save: (next: Loan[]) => void,
  now = new Date(),
): Promise<{ added: number } | { problem: string }> {
  const link = readLibbyLink()
  if (!link) return { problem: 'Libby is not connected.' }
  try {
    const data = await ask({ action: 'loans', token: link.token, ...(link.host ? { host: link.host } : {}) })
    const fromLibby = Array.isArray(data.loans) ? (data.loans as LibbyLoan[]) : []
    const next = mergeLibbyLoans(loans, fromLibby, now)
    if (JSON.stringify(next) !== JSON.stringify(loans)) save(next)
    writeLibbyLink({ ...link, checked: now.toISOString(), problem: undefined })
    return { added: next.length - loans.length }
  } catch (error) {
    const status = (error as { status?: number }).status
    const problem = error instanceof Error ? error.message : 'Libby did not answer.'
    // Only a refusal of the token needs a new code; anything else is tried again later.
    writeLibbyLink({ ...link, checked: now.toISOString(), problem: status === 401 ? problem : undefined })
    return { problem }
  }
}
