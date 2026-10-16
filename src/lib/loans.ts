// Borrowed: due dates for library loans, digital or paper. Kept as a small synced preference, so every device
// has the same list. Renewing happens at the library (Libby, the library's catalog, or a link the reader sets);
// Noesis opens the right page and records the new date.
import type { LibrarySystem } from './publicLibrary'

export type LoanKind = 'ebook' | 'audiobook' | 'physical'
export const LOAN_KINDS: Array<{ id: LoanKind; label: string }> = [
  { id: 'ebook', label: 'E-book' },
  { id: 'audiobook', label: 'Audiobook' },
  { id: 'physical', label: 'Paper copy' },
]

export type Loan = {
  id: string
  title: string
  author?: string
  kind: LoanKind
  lender?: string // the library, or a friend
  due: string // YYYY-MM-DD
  renewUrl?: string
  bookId?: string // the book in the Noesis library, when there is one
  libbyId?: string // the title in Libby, for loans brought in from a connected Libby
  cover?: string
  renewals?: number
  returnedAt?: string
  added: string
  updated?: string
}

export const LOANS_KEY = 'noesis:loans:v1'
export const LIBBY_SHELF = 'https://libbyapp.com/shelf'
const CHANGED = 'noesis-loans-changed'

export function readLoans(storage: Storage | null = typeof window === 'undefined' ? null : localStorage): Loan[] {
  try {
    const parsed = JSON.parse(storage?.getItem(LOANS_KEY) ?? '[]') as unknown
    return (Array.isArray(parsed) ? parsed : []).filter(
      (item): item is Loan =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(item.due)),
    )
  } catch {
    return []
  }
}

export function writeLoans(
  loans: Loan[],
  storage: Storage | null = typeof window === 'undefined' ? null : localStorage,
) {
  try {
    storage?.setItem(LOANS_KEY, JSON.stringify(loans))
  } catch {
    // Storage full or blocked: the change lasts for this visit.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

export function onLoansChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const storage = (event: StorageEvent) => {
    if (event.key === LOANS_KEY) listener()
  }
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', storage)
  }
}

export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const atNoon = (day: string) => new Date(`${day}T12:00:00`)

export function daysLeft(loan: Pick<Loan, 'due'>, today = localDay()): number {
  return Math.round((atNoon(loan.due).getTime() - atNoon(today).getTime()) / 86_400_000)
}

// Plain words for the date: "Due today", "Due tomorrow", "Due in 3 days", "Due Mon, Oct 21", "Was due Oct 10".
export function dueText(loan: Pick<Loan, 'due'>, today = localDay()): string {
  const days = daysLeft(loan, today)
  const date = atNoon(loan.due)
  if (days < 0) return `Was due ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= 6) return `Due in ${days} days`
  return `Due ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
}

export const activeLoans = (loans: Loan[]) =>
  loans.filter((loan) => !loan.returnedAt).sort((a, b) => a.due.localeCompare(b.due))

// What Home shows: loans due within three days, or whose date has passed.
export const dueSoon = (loans: Loan[], today = localDay(), within = 3) =>
  activeLoans(loans).filter((loan) => daysLeft(loan, today) <= within)

// Where renewing happens: the reader's own link, else Libby for e-books and audiobooks, else the library's
// "checked out" page when its catalog is on BiblioCommons, else the library's website.
export function renewLink(loan: Loan, library: LibrarySystem | null): string | undefined {
  if (loan.renewUrl) return loan.renewUrl
  if (loan.kind !== 'physical') return LIBBY_SHELF
  if (library?.catalog) return `https://${library.catalog}.bibliocommons.com/v2/checkedout`
  return library?.website
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14)

export function newLoan(input: Omit<Loan, 'id' | 'added'>, now = new Date()): Loan {
  return { ...input, title: input.title.trim().slice(0, 200), id: `loan-${uid()}`, added: now.toISOString() }
}

export function renewed(loan: Loan, due: string, now = new Date()): Loan {
  return { ...loan, due, renewals: (loan.renewals ?? 0) + 1, updated: now.toISOString() }
}

export function returned(loan: Loan, now = new Date()): Loan {
  return { ...loan, returnedAt: now.toISOString(), updated: now.toISOString() }
}

// A date a few weeks on, as the usual loan length for a new loan's first guess.
export function weeksFrom(today: string, weeks: number): string {
  const date = atNoon(today)
  date.setDate(date.getDate() + weeks * 7)
  return localDay(date)
}
