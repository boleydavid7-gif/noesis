import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  BookOpen,
  Brain,
  CalendarClock,
  Check,
  ChevronLeft,
  Cloud,
  ExternalLink,
  HardDrive,
  Highlighter,
  Library,
  MessageCircleQuestion,
  NotebookPen,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import './onboarding.css'

// The first visit: what Noesis is, in a few plain pages, then an account and (optionally) the person's own storage.
// The step is kept so a storage sign-in that leaves the page comes back to the same place.
export const INTRO_KEY = 'noesis:intro:v1'

export function readIntroStep(): number | 'done' | null {
  try {
    const value = localStorage.getItem(INTRO_KEY)
    if (value === 'done') return 'done'
    if (value && /^\d+$/.test(value)) return Number(value)
  } catch {
    // Storage blocked: show it from the start.
  }
  return null
}

export function saveIntroStep(step: number | 'done') {
  try {
    localStorage.setItem(INTRO_KEY, String(step))
  } catch {
    // Storage blocked: it shows again next time.
  }
}

type Row = { icon: LucideIcon; tone: string; title: string; text: string }
type Page = { title: string; lead: string; rows?: Row[] }

const PAGES: Page[] = [
  {
    title: 'Welcome to Noesis',
    lead: 'A place to read your books, keep what stays with you, and find what to read next.',
  },
  {
    title: 'Read what you own',
    lead: 'Your books sit together, wherever you read them.',
    rows: [
      {
        icon: BookOpen,
        tone: 'blue',
        title: 'EPUB and PDF',
        text: 'Add files from your phone or computer. They open right here.',
      },
      {
        icon: ExternalLink,
        tone: 'teal',
        title: 'Books you read elsewhere',
        text: 'Kindle, Libby or Apple Books: the cover opens the book there.',
      },
      {
        icon: CalendarClock,
        tone: 'orange',
        title: 'Library loans',
        text: 'Due dates in one list, with Renew where the library allows it.',
      },
    ],
  },
  {
    title: 'Keep what you read',
    lead: 'Mark a line, write a thought, and find it again later.',
    rows: [
      {
        icon: Highlighter,
        tone: 'yellow',
        title: 'Highlights and notes',
        text: 'Select a passage to keep it. Add a thought to it.',
      },
      { icon: Brain, tone: 'indigo', title: 'Second Brain', text: 'Everything you keep, in one place you can search.' },
      {
        icon: NotebookPen,
        tone: 'green',
        title: 'Noesis Notes',
        text: 'A notebook for paper books and anything you read away from here.',
      },
    ],
  },
  {
    title: 'Go down a rabbit hole',
    lead: 'Start from something you want to understand.',
    rows: [
      {
        icon: MessageCircleQuestion,
        tone: 'pink',
        title: 'Begin with a question',
        text: 'Each one comes with books, articles and videos.',
      },
      {
        icon: ArrowDown,
        tone: 'indigo',
        title: 'Go deeper',
        text: 'Ask what you want to know next, as far as you want.',
      },
      {
        icon: Library,
        tone: 'teal',
        title: 'Libraries near you',
        text: 'See which libraries have a copy on the shelf or in Libby.',
      },
      {
        icon: Sparkles,
        tone: 'blue',
        title: 'Noema',
        text: 'Ask about a passage as you read. It sees only what you allow.',
      },
    ],
  },
  {
    title: 'Yours, and private',
    lead: 'Noesis works without an account. One makes it go further.',
    rows: [
      {
        icon: Smartphone,
        tone: 'green',
        title: 'On this device first',
        text: 'Your books and notes are kept here and work offline.',
      },
      {
        icon: Cloud,
        tone: 'blue',
        title: 'An account to sync',
        text: 'Your library and notes follow you to your other devices.',
      },
      {
        icon: HardDrive,
        tone: 'orange',
        title: 'Your own storage',
        text: 'Google Drive, OneDrive or Dropbox can hold your books.',
      },
    ],
  },
]
const ACCOUNT = PAGES.length
const STORAGE = PAGES.length + 1
export const INTRO_STEPS = PAGES.length + 2

export function Onboarding({
  start = 0,
  mark,
  signedIn,
  email,
  account,
  storage,
  onDone,
}: {
  start?: number
  mark: ReactNode
  signedIn: boolean
  email?: string
  account: ReactNode
  storage: ReactNode
  onDone: () => void
}) {
  const [step, setStep] = useState(() => Math.min(Math.max(start, 0), INTRO_STEPS - 1))
  const [back, setBack] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const go = (next: number) => {
    if (next >= INTRO_STEPS) return finish()
    const clamped = Math.max(0, next)
    setBack(clamped < step)
    setStep(clamped)
    saveIntroStep(clamped)
  }
  const finish = () => {
    saveIntroStep('done')
    onDone()
  }
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
    body.current?.focus({ preventScroll: true })
  }, [step])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest('input, textarea, select')
      if (event.key === 'Escape') finish()
      else if (!typing && event.key === 'ArrowRight') go(step + 1)
      else if (!typing && event.key === 'ArrowLeft') go(step - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const page = PAGES[step]
  const primary =
    step === 0
      ? 'Begin'
      : step === ACCOUNT
        ? signedIn
          ? 'Continue'
          : 'Not now'
        : step === STORAGE
          ? 'Start reading'
          : 'Continue'

  return (
    <div className="intro" role="dialog" aria-modal="true" aria-label="Welcome to Noesis">
      <div className="intro-bar">
        {step > 0 ? (
          <button className="intro-back" onClick={() => go(step - 1)} aria-label="Back">
            <ChevronLeft size={22} />
          </button>
        ) : (
          <span />
        )}
        <div className="intro-dots" aria-label={`Step ${step + 1} of ${INTRO_STEPS}`}>
          {Array.from({ length: INTRO_STEPS }, (_, index) => (
            <span key={index} className={index === step ? 'intro-dot intro-dot-on' : 'intro-dot'} />
          ))}
        </div>
        {step < STORAGE ? (
          <button className="intro-skip" onClick={finish}>
            Skip
          </button>
        ) : (
          <span />
        )}
      </div>
      <div
        className="intro-body"
        ref={body}
        tabIndex={-1}
        onTouchStart={(event) => {
          const point = event.touches[0]
          touch.current = { x: point.clientX, y: point.clientY }
        }}
        onTouchEnd={(event) => {
          const from = touch.current
          touch.current = null
          if (!from || (event.target as HTMLElement).closest('input, textarea, select, form')) return
          const point = event.changedTouches[0]
          const dx = point.clientX - from.x
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(point.clientY - from.y) * 1.5) go(step + (dx < 0 ? 1 : -1))
        }}
      >
        <div key={step} className={'intro-page' + (back ? ' intro-page-back' : '')}>
          {page ? (
            <>
              {step === 0 ? <div className="intro-mark">{mark}</div> : null}
              <h1 className={step === 0 ? 'intro-title intro-title-big' : 'intro-title'}>{page.title}</h1>
              <p className="intro-lead">{page.lead}</p>
              {page.rows ? (
                <ul className="intro-rows">
                  {page.rows.map((row) => (
                    <li key={row.title}>
                      <span className={`intro-tile intro-tile-${row.tone}`} aria-hidden="true">
                        <row.icon size={19} strokeWidth={2.2} />
                      </span>
                      <span className="intro-row-text">
                        <strong>{row.title}</strong>
                        <span>{row.text}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : step === ACCOUNT ? (
            <>
              <span className="intro-tile intro-tile-blue intro-tile-big" aria-hidden="true">
                <Cloud size={30} />
              </span>
              <h1 className="intro-title">Create your account</h1>
              <p className="intro-lead">
                Keep your library and notes safe, and open them on your phone, tablet and computer. You can also do this
                later in Settings.
              </p>
              {signedIn ? (
                <div className="intro-done">
                  <Check size={20} />
                  <span>Signed in{email ? ` as ${email}` : ''}.</span>
                </div>
              ) : (
                <div className="intro-account">{account}</div>
              )}
            </>
          ) : (
            <>
              <span className="intro-tile intro-tile-orange intro-tile-big" aria-hidden="true">
                <HardDrive size={30} />
              </span>
              <h1 className="intro-title">Your own storage</h1>
              <p className="intro-lead">
                Optional. Connect Google Drive, OneDrive or Dropbox and Noesis backs up your library there and brings in
                books you keep in it.
              </p>
              <div className="intro-storage">{storage}</div>
            </>
          )}
        </div>
      </div>
      <div className="intro-foot">
        <button
          className={step === ACCOUNT && !signedIn ? 'intro-secondary' : 'intro-primary'}
          onClick={() => go(step + 1)}
        >
          {primary}
        </button>
      </div>
    </div>
  )
}
