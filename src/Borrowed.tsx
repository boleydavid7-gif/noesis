// Borrowed: loans with their due dates, a way to renew at the library, and the external e-books form.
import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, ExternalLink, Headphones, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { LibraryBook } from './lib/library'
import {
  LIBBY_SHELF,
  LOAN_KINDS,
  activeLoans,
  daysLeft,
  dueSoon,
  dueText,
  localDay,
  newLoan,
  onLoansChanged,
  readLoans,
  renewLink,
  renewed,
  returned,
  weeksFrom,
  writeLoans,
  type Loan,
  type LoanKind,
} from './lib/loans'
import { useChosenLibrary } from './lib/publicLibrary'
import { cleanLink, linkLabel } from './lib/notesBooks'
import {
  connectLibby,
  libbyDue,
  onLibbyLinkChanged,
  readLibbyLink,
  refreshFromLibby,
  writeLibbyLink,
} from './lib/libbyLink'
import { timeAgo } from './lib/time'

export function useLoans(): [Loan[], (next: Loan[]) => void] {
  const [loans, setLoans] = useState(readLoans)
  useEffect(() => onLoansChanged(() => setLoans(readLoans())), [])
  return [loans, writeLoans]
}

const KIND_ICON: Record<LoanKind, typeof BookOpen> = { ebook: BookOpen, audiobook: Headphones, physical: BookOpen }

function LoanRow({
  loan,
  loans,
  save,
  onUndo,
  book,
  onOpenBook,
}: {
  loan: Loan
  loans: Loan[]
  save: (next: Loan[]) => void
  onUndo: (label: string, before: Loan[]) => void
  book?: LibraryBook
  onOpenBook?: (book: LibraryBook) => void
}) {
  const library = useChosenLibrary()
  const [renewing, setRenewing] = useState(false)
  const [date, setDate] = useState(weeksFrom(loan.due, 3))
  const days = daysLeft(loan)
  const Icon = KIND_ICON[loan.kind]
  const renewAt = renewLink(loan, library)
  const put = (next: Loan) => save(loans.map((item) => (item.id === next.id ? next : item)))
  return (
    <li className={`loan-row${days <= 3 ? ' loan-row-soon' : ''}`}>
      {loan.cover ? (
        <a
          className="loan-cover"
          href={loan.renewUrl ?? LIBBY_SHELF}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open “${loan.title}” in Libby`}
        >
          <img src={loan.cover} alt="" referrerPolicy="no-referrer" />
        </a>
      ) : (
        <span className="loan-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <div className="loan-body">
        {book && onOpenBook ? (
          <button className="loan-title" onClick={() => onOpenBook(book)}>
            {loan.title}
          </button>
        ) : (
          <strong className="loan-title">{loan.title}</strong>
        )}
        <small>
          {[
            LOAN_KINDS.find((item) => item.id === loan.kind)?.label,
            loan.lender,
            loan.renewals ? `renewed ${loan.renewals}×` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
        <span className="loan-due">{dueText(loan)}</span>
        {renewing ? (
          <form
            className="loan-renew-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!date) return
              put(renewed(loan, date))
              setRenewing(false)
            }}
          >
            <label>
              New due date
              <input type="date" value={date} min={localDay()} onChange={(event) => setDate(event.target.value)} />
            </label>
            <button className="primary-button" type="submit">
              Save
            </button>
            <button type="button" className="text-button" onClick={() => setRenewing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="loan-actions">
            {renewAt ? (
              <a
                className="secondary-button"
                href={renewAt}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => {
                  if (!loan.libbyId) setRenewing(true)
                }}
              >
                <RotateCcw size={13} /> Renew
              </a>
            ) : null}
            {loan.kind !== 'physical' && renewAt !== LIBBY_SHELF && !loan.libbyId ? (
              <a className="text-button" href={LIBBY_SHELF} target="_blank" rel="noreferrer noopener">
                Open in Libby <ExternalLink size={11} />
              </a>
            ) : null}
            {loan.libbyId ? null : (
              <>
                <button className="text-button" onClick={() => setRenewing(true)}>
                  Renewed…
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    onUndo(`Returned “${loan.title}”.`, loans)
                    put(returned(loan))
                  }}
                >
                  <Check size={13} /> Returned
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// The full list (Library) or only what is due soon (Home).
export function Borrowed({
  books,
  onOpenBook,
  compact = false,
}: {
  books: LibraryBook[]
  onOpenBook?: (book: LibraryBook) => void
  compact?: boolean
}) {
  const [loans, save] = useLoans()
  const library = useChosenLibrary()
  const [adding, setAdding] = useState(false)
  const [undo, setUndo] = useState<{ label: string; before: Loan[] } | null>(null)
  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 7_000)
    return () => window.clearTimeout(timer)
  }, [undo])
  const shown = compact ? dueSoon(loans) : activeLoans(loans)
  const past = loans
    .filter((loan) => loan.returnedAt)
    .sort((a, b) => (b.returnedAt ?? '').localeCompare(a.returnedAt ?? ''))
  if (compact && !shown.length) return null
  const bookFor = (loan: Loan) => books.find((book) => book.id === loan.bookId)
  return (
    <section className={`section-block borrowed${compact ? ' borrowed-compact' : ''}`} aria-label="Borrowed">
      <div className="section-heading">
        <div>
          <h2>{compact ? 'Due soon' : 'Borrowed'}</h2>
        </div>
        {compact ? null : (
          <button className="text-button" onClick={() => setAdding((value) => !value)}>
            <Plus size={14} /> Add a loan
          </button>
        )}
      </div>
      {compact ? null : <LibbyConnect loans={loans} save={save} />}
      {adding ? (
        <LoanForm
          books={books}
          lender={library?.name}
          onCancel={() => setAdding(false)}
          onSave={(loan) => {
            save([...loans, loan])
            setAdding(false)
          }}
        />
      ) : null}
      {shown.length ? (
        <ul className="loan-list">
          {shown.map((loan) => (
            <LoanRow
              key={loan.id}
              loan={loan}
              loans={loans}
              save={save}
              onUndo={(label, before) => setUndo({ label, before })}
              book={bookFor(loan)}
              onOpenBook={onOpenBook}
            />
          ))}
        </ul>
      ) : compact ? null : (
        <p className="context-empty">Nothing borrowed. Add a loan to keep its due date here.</p>
      )}
      {!compact && past.length ? (
        <details className="loan-past">
          <summary>Returned ({past.length})</summary>
          <ul>
            {past.slice(0, 30).map((loan) => (
              <li key={loan.id}>
                <span>{loan.title}</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setUndo({ label: 'Removed.', before: loans })
                    save(loans.filter((item) => item.id !== loan.id))
                  }}
                  aria-label={`Remove ${loan.title}`}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {undo ? (
        <div className="loan-undo" role="status">
          <span>{undo.label}</span>
          <button
            className="text-button"
            onClick={() => {
              save(undo.before)
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </section>
  )
}

// Libby, connected: loans, due dates and covers come from Libby itself, and update when Borrowed opens (at most
// every 15 minutes) or on Update.
function LibbyConnect({ loans, save }: { loans: Loan[]; save: (next: Loan[]) => void }) {
  const [link, setLink] = useState(readLibbyLink)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [leaving, setLeaving] = useState(false)
  const latest = useRef(loans)
  latest.current = loans
  useEffect(() => onLibbyLinkChanged(() => setLink(readLibbyLink())), [])
  const update = async () => {
    setBusy(true)
    const result = await refreshFromLibby(latest.current, save)
    setBusy(false)
    setMessage('problem' in result ? result.problem : '')
  }
  useEffect(() => {
    if (libbyDue(readLibbyLink())) void update()
    // Once, when Borrowed opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!link || link.problem) {
    return (
      <div className="libby-connect">
        {open ? (
          <form
            className="libby-connect-form"
            onSubmit={async (event) => {
              event.preventDefault()
              setBusy(true)
              setMessage('')
              try {
                await connectLibby(code)
                setOpen(false)
                setCode('')
                await update()
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'That did not work.')
              } finally {
                setBusy(false)
              }
            }}
          >
            <p>
              In the Libby you are signed in to, open Menu › Copy To Another Device › Sonos Speakers, then enter the
              code it shows.
            </p>
            <label>
              Code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="8 digits"
                autoFocus
              />
            </label>
            <div className="recovery-actions">
              <button className="primary-button" type="submit" disabled={busy || code.length !== 8}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" className="text-button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="libby-connect-row">
            <span>{link?.problem ?? 'Bring in your Libby loans and due dates.'}</span>
            <button className="secondary-button" onClick={() => setOpen(true)}>
              {link?.problem ? 'Connect again' : 'Connect Libby'}
            </button>
          </div>
        )}
        {message ? <p className="libby-connect-note">{message}</p> : null}
      </div>
    )
  }
  return (
    <div className="libby-connect">
      <div className="libby-connect-row">
        <span>Libby{link.checked ? ` · updated ${timeAgo(link.checked)}` : ''}</span>
        {leaving ? (
          <>
            <button
              className="text-button"
              onClick={() => {
                writeLibbyLink(null)
                setLeaving(false)
              }}
            >
              Disconnect
            </button>
            <button className="text-button" onClick={() => setLeaving(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button className="text-button" onClick={() => void update()} disabled={busy}>
              {busy ? 'Updating…' : 'Update'}
            </button>
            <button className="text-button" onClick={() => setLeaving(true)}>
              Disconnect
            </button>
          </>
        )}
      </div>
      {message ? <p className="libby-connect-note">{message}</p> : null}
    </div>
  )
}

export function LoanForm({
  books,
  lender,
  initial,
  onCancel,
  onSave,
}: {
  books: LibraryBook[]
  lender?: string
  initial?: Partial<Loan>
  onCancel: () => void
  onSave: (loan: Loan) => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [kind, setKind] = useState<LoanKind>(initial?.kind ?? 'ebook')
  const [due, setDue] = useState(initial?.due ?? weeksFrom(localDay(), 3))
  const [from, setFrom] = useState(initial?.lender ?? lender ?? '')
  const [link, setLink] = useState(initial?.renewUrl ?? '')
  const linked = books.find((book) => book.title.toLowerCase() === title.trim().toLowerCase())
  const linkOk = !link.trim() || Boolean(cleanLink(link))
  return (
    <form
      className="loan-form panel-card"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim() || !due || !linkOk) return
        onSave(
          newLoan({
            title: title.trim(),
            author: linked?.author ?? initial?.author,
            kind,
            due,
            lender: from.trim() || undefined,
            renewUrl: cleanLink(link),
            bookId: initial?.bookId ?? linked?.id,
          }),
        )
      }}
    >
      <label>
        Title
        <input list="loan-titles" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus />
        <datalist id="loan-titles">
          {books.map((book) => (
            <option key={book.id} value={book.title} />
          ))}
        </datalist>
      </label>
      <div className="loan-kinds" role="radiogroup" aria-label="Kind of copy">
        {LOAN_KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={kind === item.id}
            onClick={() => setKind(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="loan-form-row">
        <label>
          Due
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} required />
        </label>
        <label>
          From (optional)
          <input value={from} onChange={(event) => setFrom(event.target.value)} placeholder="Library or person" />
        </label>
      </div>
      <label>
        Renew at (optional)
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder={kind === 'physical' ? "Your library's account page" : 'Libby is used when this is empty'}
          aria-invalid={!linkOk}
        />
      </label>
      <div className="recovery-actions">
        <button className="primary-button" type="submit" disabled={!title.trim() || !linkOk}>
          Save
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export const STORES = ['Kindle', 'Apple Books', 'Google Play Books', 'Kobo', 'Libby', 'Hoopla', 'Other']

// An e-book read somewhere else: its title, where it is, and (when borrowed) its due date.
export function AddExternalBook({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (book: { title: string; author: string; link?: string; store?: string; due?: string }) => void
}) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [store, setStore] = useState('Kindle')
  const [link, setLink] = useState('')
  const [borrowed, setBorrowed] = useState(false)
  const [due, setDue] = useState(weeksFrom(localDay(), 3))
  const linkOk = !link.trim() || Boolean(cleanLink(link))
  return (
    <form
      className="loan-form panel-card"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim() || !linkOk) return
        onSave({
          title: title.trim(),
          author: author.trim(),
          link: cleanLink(link) ?? (store === 'Libby' ? LIBBY_SHELF : undefined),
          store,
          due: borrowed ? due : undefined,
        })
      }}
    >
      <h3>Add an external e-book</h3>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus />
      </label>
      <label>
        Author (optional)
        <input value={author} onChange={(event) => setAuthor(event.target.value)} />
      </label>
      <label>
        Where you read it
        <select value={store} onChange={(event) => setStore(event.target.value)}>
          {STORES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Link to the book (optional)
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="The book's page in that app or store"
          aria-invalid={!linkOk}
        />
      </label>
      {link && cleanLink(link) ? <small className="context-empty">Opens at {linkLabel(cleanLink(link)!)}</small> : null}
      <label className="loan-check">
        <input type="checkbox" checked={borrowed} onChange={(event) => setBorrowed(event.target.checked)} /> Borrowed
      </label>
      {borrowed ? (
        <label>
          Due
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
      ) : null}
      <div className="recovery-actions">
        <button className="primary-button" type="submit" disabled={!title.trim() || !linkOk}>
          Add
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
