// Daily highlights on Home: a card with today's few, and a full-screen review that shows them one at a time with a
// way to see each more often, less often or not again, open it in its book, or turn it into a review card.
// The choosing and spacing live in lib/dailyHighlights.ts.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, BookOpen, Image, Layers, X } from 'lucide-react'
import type { BrainNote } from './lib/knowledge'
import { HIGHLIGHT_COLORS } from './lib/knowledge'
import {
  dayKey,
  markDone,
  markSeen,
  nextIn,
  onDailyChanged,
  readDaily,
  setFrequency,
  today,
  writeDaily,
  type DailyHighlight,
  type DailyState,
  type Frequency,
} from './lib/dailyHighlights'
import { tap } from './lib/device'
import './highlights.css'

type Actions = {
  onOpenInBook: (note: BrainNote) => void
  onMakeCard: (note: BrainNote) => void
  onQuoteCard: (note: BrainNote, text: string) => void
  onNotice: (message: string) => void
}

function useDaily(notes: BrainNote[], count: number) {
  const [state, setState] = useState<DailyState>(readDaily)
  useEffect(() => onDailyChanged(() => setState(readDaily())), [])
  const [date, setDate] = useState(dayKey)
  // A new day while the app stays open chooses again.
  useEffect(() => {
    const check = () => setDate(dayKey())
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  const day = useMemo(() => today(notes, state, count, date), [notes, state, count, date])
  useEffect(() => {
    if (day.state !== state) writeDaily(day.state)
  }, [day.state, state])
  const save = (next: DailyState) => {
    setState(next)
    writeDaily(next)
  }
  return { ...day, date, save }
}

const sourceLine = (note: BrainNote) =>
  [note.bookTitle ?? (note.source !== 'Noesis' ? note.source : ''), note.author, note.chapter]
    .filter(Boolean)
    .join(' · ')

/** The Home card: today's highlights, or a quiet line once they have been read. */
export function DailyHighlightsCard({ notes, count, ...actions }: { notes: BrainNote[]; count: number } & Actions) {
  const daily = useDaily(notes, count)
  const [open, setOpen] = useState(false)
  if (!daily.items.length) return null
  const first = daily.items[0]
  return (
    <>
      {daily.done ? (
        <section className="daily-card daily-card-done panel-card" aria-label="Daily highlights">
          <span>
            <strong>Today’s highlights</strong>
            <small>Read · next ones tomorrow</small>
          </span>
          <button className="text-button" onClick={() => setOpen(true)}>
            Read again
          </button>
        </section>
      ) : (
        <button className="daily-card panel-card" onClick={() => setOpen(true)} aria-label="Read today’s highlights">
          <span className="daily-card-head">
            <strong>Today’s highlights</strong>
            <small>{daily.items.length}</small>
          </span>
          <blockquote>{first.text}</blockquote>
          <small className="daily-card-source">{sourceLine(first.note)}</small>
          <span className="daily-card-go">
            Read <ArrowRight size={15} />
          </span>
        </button>
      )}
      {open
        ? createPortal(
            <DailyReview
              items={daily.items}
              state={daily.state}
              date={daily.date}
              save={daily.save}
              onClose={() => setOpen(false)}
              {...actions}
            />,
            document.body,
          )
        : null}
    </>
  )
}

function DailyReview({
  items,
  state,
  date,
  save,
  onClose,
  onOpenInBook,
  onMakeCard,
  onQuoteCard,
  onNotice,
}: {
  items: DailyHighlight[]
  state: DailyState
  date: string
  save: (next: DailyState) => void
  onClose: () => void
} & Actions) {
  const [at, setAt] = useState(0)
  const finished = at >= items.length
  const item = items[at]
  const touch = useRef<{ x: number; y: number } | null>(null)
  const latest = useRef(state)
  latest.current = state

  // Shown counts as seen; reaching the end marks the day read.
  useEffect(() => {
    if (item) save(markSeen(latest.current, item.note.id, date))
    else save(markDone(latest.current, date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(items.length, next))
    if (clamped !== at) {
      tap()
      setAt(clamped)
    }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') go(at + 1)
      else if (event.key === 'ArrowLeft') go(at - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  useEffect(() => {
    document.body.classList.add('daily-open')
    return () => document.body.classList.remove('daily-open')
  }, [])

  const frequency = item ? state.items[item.note.id]?.frequency : undefined
  const choose = (value: Frequency) => {
    if (!item) return
    const next = frequency === value ? undefined : value
    save(setFrequency(latest.current, item.note.id, next))
    if (value === 'never' && next) {
      onNotice('It won’t come back in daily highlights.')
      go(at + 1)
    }
  }
  const color = item?.note.color ? HIGHLIGHT_COLORS.find((entry) => entry.id === item.note.color)?.css : undefined
  const comesBack = item ? nextIn(state, item.note.id, date) : 0

  return (
    <div
      className="daily-review"
      role="dialog"
      aria-modal="true"
      aria-label="Today’s highlights"
      onTouchStart={(event) => {
        const point = event.touches[0]
        touch.current = { x: point.clientX, y: point.clientY }
      }}
      onTouchEnd={(event) => {
        const from = touch.current
        touch.current = null
        if (!from) return
        const point = event.changedTouches[0]
        const dx = point.clientX - from.x
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(point.clientY - from.y) * 1.5) go(at + (dx < 0 ? 1 : -1))
      }}
    >
      <header className="daily-review-bar">
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="daily-dots" aria-label={finished ? 'Done' : `${at + 1} of ${items.length}`}>
          {items.map((entry, index) => (
            <span key={entry.note.id} className={index === at ? 'on' : index < at ? 'past' : ''} />
          ))}
        </div>
        <span className="daily-count">{finished ? '' : `${at + 1} of ${items.length}`}</span>
      </header>

      <main key={at} className="daily-review-page">
        {item ? (
          <>
            <figure className="daily-quote" style={color ? ({ '--mark': color } as CSSProperties) : undefined}>
              <blockquote>{item.text}</blockquote>
              {item.comment ? <p className="daily-comment">{item.comment}</p> : null}
              <figcaption>
                {item.note.bookTitle ? <strong>{item.note.bookTitle}</strong> : null}
                <span>{[item.note.author, item.note.chapter].filter(Boolean).join(' · ') || item.note.source}</span>
              </figcaption>
            </figure>
            <div className="daily-often" role="group" aria-label="How often this comes back">
              <button aria-pressed={frequency === 'less'} onClick={() => choose('less')}>
                Less often
              </button>
              <button aria-pressed={frequency === 'more'} onClick={() => choose('more')}>
                More often
              </button>
              <button aria-pressed={frequency === 'never'} onClick={() => choose('never')}>
                Not again
              </button>
            </div>
            <p className="daily-next">
              {frequency === 'never'
                ? 'Left out of daily highlights.'
                : comesBack > 0
                  ? `Back in about ${comesBack < 14 ? `${comesBack} days` : `${Math.round(comesBack / 7)} weeks`}.`
                  : ''}
            </p>
            <div className="daily-actions">
              {item.note.bookId ? (
                <button className="text-button" onClick={() => onOpenInBook(item.note)}>
                  <BookOpen size={15} /> Open in book
                </button>
              ) : null}
              <button className="text-button" onClick={() => onMakeCard(item.note)}>
                <Layers size={15} /> Review card
              </button>
              <button className="text-button" onClick={() => onQuoteCard(item.note, item.text)}>
                <Image size={15} /> Quote card
              </button>
            </div>
          </>
        ) : (
          <div className="daily-end">
            <h2>That’s today’s highlights</h2>
            <p>The next ones come tomorrow.</p>
            <button className="primary-button" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </main>

      {finished ? null : (
        <footer className="daily-review-foot">
          <button className="icon-button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous">
            <ArrowLeft size={18} />
          </button>
          <button className="primary-button" onClick={() => go(at + 1)}>
            {at === items.length - 1 ? 'Finish' : 'Next'}
          </button>
        </footer>
      )}
    </div>
  )
}
