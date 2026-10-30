// Rabbit holes: one question at a time, each with a guess, an answer, the learner's own words and the doors it
// leads to (Deeper, Sideways, Curiouser). The map is an outline of where the hole has gone; climbing out keeps
// what stuck and offers recall cards; What you found gathers the learner's own words. Plain and quiet by design:
// rows, hairlines and the serif for questions, as in reading and research apps.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { exploreError, exploreInto, isExploring, subscribeExploring, type EditSubject } from './lib/subjectExplore'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  Headphones,
  Map as MapIcon,
  MessageCircleQuestionMark as NoemaIcon,
  Newspaper,
  Pencil,
  Play,
  RotateCw,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { FreeCopyFinder } from './FreeCopyFinder'
import { AtYourLibrary } from './PublicLibrary'
import type { LibraryBook } from './lib/library'
import { authHeaders } from './lib/auth'
import { noemaUsed } from './lib/plus'
import { newCard, readReviewCards, writeReviewCards, type DraftCard } from './lib/review'
import { AuthRequiredError, requestDoors, requestSubject, requestSumUp } from './lib/pathClient'
import type { LearningPath } from './lib/pathPlan'
import {
  booksForNow,
  groupPicks,
  markUsed,
  minutesText,
  nowQuestions,
  removeQuestion,
  answerQuestion,
  reopenQuestion,
  subjectOf,
  trailOf,
  updatePick,
  withQuestion,
  type Pick,
  type PickType,
  type Question,
  type Subject,
  type HoleOrigin,
} from './lib/subjects'
import {
  DOOR_WORD,
  climbOut,
  connectedHoles,
  doorOf,
  firstQuestion,
  foundIn,
  holeCounts,
  holeMap,
  holeMarkdown,
  isExplained,
  isVisited,
  lastOpen,
  markRecalled,
  markVisited,
  recallDue,
  recallPassage,
  sinceSurfaced,
  startHole,
  sumItUp,
  takeDoor,
  withDoors,
  withGround,
} from './lib/rabbitHole'
import './rabbitHole.css'
import { SourceSheet } from './SourceSheet'
import { sourceView } from './lib/source'

const PICK_ICON: Record<PickType, typeof BookOpen> = {
  book: BookOpen,
  read: Newspaper,
  watch: Play,
  listen: Headphones,
  try: Wrench,
}

const coverOf = (book: LibraryBook) => book.coverDataUrl || book.coverUrl || ''
const problem = (reason: unknown, fallback: string) =>
  reason instanceof AuthRequiredError
    ? 'Sign in to go down rabbit holes.'
    : reason instanceof Error
      ? reason.message
      : fallback

// ---------- Falling in ----------

const EXAMPLES = ['Why do we dream?', 'How did the Romans build roads?', 'What is a black hole made of?']

export function SubjectStarter({
  onStart,
  from,
  onClearFrom,
  signedIn,
  onSignIn,
}: {
  onStart: (path: LearningPath, firstQuestionId: string) => void
  from?: HoleOrigin | null
  onClearFrom?: () => void
  signedIn: boolean
  onSignIn: () => void
}) {
  const [words, setWords] = useState('')
  const field = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (from) field.current?.focus()
  }, [from])
  function fallIn(event?: React.FormEvent, text = words) {
    event?.preventDefault()
    const path = startHole(text, from ?? undefined)
    const first = path?.subject && firstQuestion(path.subject)
    if (!path || !first) return
    onStart(path, first.id)
    setWords('')
    onClearFrom?.()
  }
  return (
    <section className="hole-start panel-card" aria-label="Start a rabbit hole">
      <form onSubmit={fallIn}>
        <h3>{from ? 'What do you want to know?' : 'What are you curious about?'}</h3>
        {from?.quote ? (
          <figure className="hole-origin">
            <blockquote>{from.quote.length > 400 ? `${from.quote.slice(0, 400)}…` : from.quote}</blockquote>
            <figcaption>
              {from.title}
              {onClearFrom ? (
                <button type="button" className="text-button" onClick={onClearFrom} aria-label="Leave the passage out">
                  <X size={14} />
                </button>
              ) : null}
            </figcaption>
          </figure>
        ) : null}
        <div className="hole-start-row">
          <textarea
            ref={field}
            value={words}
            onChange={(event) => setWords(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) fallIn(event as unknown as React.FormEvent)
            }}
            maxLength={200}
            rows={1}
            aria-label={from ? 'What you want to know' : 'What you are curious about'}
          />
          <button className="primary-button" type="submit" disabled={!words.trim() && !from?.quote}>
            <ArrowDown size={15} /> Fall in
          </button>
        </div>
        {!signedIn ? (
          <p className="hole-signin">
            Answers need an account.{' '}
            <button type="button" className="text-button" onClick={onSignIn}>
              Sign in
            </button>
          </p>
        ) : null}
        {!words && !from ? (
          <div className="hole-examples">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => fallIn(undefined, example)}>
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </form>
    </section>
  )
}

// ---------- One rabbit hole ----------

type View = { kind: 'map' } | { kind: 'found' } | { kind: 'question'; id: string }

// What a source opened inside Noesis can do with a passage picked in it.
export type SourceHands = {
  fallIn: (origin: HoleOrigin) => void
  keep: (passage: string, title: string, url: string) => void
}

export function SubjectView({
  path,
  holes = [],
  library,
  onChange,
  onOpenBook,
  onOpenHole,
  onAsk,
  onNote,
  onNotice,
  initialQuestion,
  onEdit,
  sources,
}: {
  sources?: SourceHands
  onEdit?: EditSubject
  path: LearningPath
  holes?: LearningPath[]
  initialQuestion?: string
  library: LibraryBook[]
  onChange: (path: LearningPath) => void
  onOpenBook?: (id: string) => void
  onOpenHole?: (pathId: string, questionId: string) => void
  onAsk?: (prompt: string) => void
  onNote?: (title: string, source: string) => void
  onNotice: (message: string) => void
}) {
  const subject = useMemo(() => subjectOf(path), [path])
  const [view, setView] = useState<View>(() =>
    initialQuestion ? { kind: 'question', id: initialQuestion } : { kind: 'map' },
  )
  const [undo, setUndo] = useState<{ label: string; before: Subject } | null>(null)
  const [climbing, setClimbing] = useState(false)
  // Coming back after a few days: one thing explained before is asked first, once a visit.
  const [recall, setRecall] = useState(() => recallDue(subject))
  const topRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 7_000)
    return () => window.clearTimeout(timer)
  }, [undo])

  const save = (next: Subject, undoLabel?: string) => {
    if (undoLabel) setUndo({ label: undoLabel, before: subject })
    onChange({ ...path, subject: next, updated: new Date().toISOString() })
  }
  const go = (next: View) => {
    setView(next)
    window.setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20)
  }
  const question = view.kind === 'question' ? subject.questions.find((q) => q.id === view.id) : undefined
  const dived = sinceSurfaced(subject).length > 0

  return (
    <div className="subject hole" ref={topRef}>
      {view.kind !== 'question' || !question ? (
        <div className="hole-tabs" role="tablist" aria-label="Rabbit hole">
          <button role="tab" aria-selected={view.kind !== 'found'} onClick={() => go({ kind: 'map' })}>
            Map
          </button>
          <button role="tab" aria-selected={view.kind === 'found'} onClick={() => go({ kind: 'found' })}>
            What you found
          </button>
        </div>
      ) : null}
      {recall && view.kind !== 'question' ? (
        <RecallCard
          question={recall}
          onDone={(open) => {
            save(markRecalled(subject, recall.id))
            setRecall(null)
            if (open) go({ kind: 'question', id: recall.id })
          }}
        />
      ) : null}
      {view.kind === 'found' ? (
        <FoundPage
          path={path}
          subject={subject}
          onSave={save}
          onOpen={(id) => go({ kind: 'question', id })}
          onNotice={onNotice}
        />
      ) : null}
      {view.kind === 'map' || (view.kind === 'question' && !question) ? (
        <HoleMapView
          path={path}
          subject={subject}
          library={library}
          onSave={save}
          onOpen={(id) => go({ kind: 'question', id })}
          onOpenBook={onOpenBook}
          onNotice={onNotice}
          onClimbOut={dived ? () => setClimbing(true) : undefined}
        />
      ) : null}
      {question ? (
        <div className="subject-split hole-split">
          <aside className="hole-aside" aria-label="The map">
            <HoleOutline
              subject={subject}
              current={question.id}
              onOpen={(id) => go({ kind: 'question', id })}
              onSave={save}
              compact
            />
          </aside>
          <QuestionPage
            key={question.id}
            path={path}
            holes={holes}
            subject={subject}
            question={question}
            library={library}
            onSave={save}
            onBack={() => go({ kind: 'map' })}
            onOpen={(id) => go({ kind: 'question', id })}
            onOpenHole={onOpenHole}
            onOpenBook={onOpenBook}
            onAsk={onAsk}
            onNote={onNote}
            onNotice={onNotice}
            onEdit={onEdit}
            sources={sources}
            onClimbOut={() => setClimbing(true)}
          />
        </div>
      ) : null}
      {climbing ? (
        <ClimbOut
          path={path}
          subject={subject}
          onClose={() => setClimbing(false)}
          onDone={(next, cards) => {
            save(next)
            setClimbing(false)
            go({ kind: 'map' })
            onNotice(
              cards ? `Climbed out. ${cards} recall ${cards === 1 ? 'card' : 'cards'} in Review.` : 'Climbed out.',
            )
          }}
        />
      ) : null}
      {undo ? (
        <div className="subject-undo" role="status">
          <span>{undo.label}</span>
          <button
            className="text-button"
            onClick={() => {
              onChange({ ...path, subject: undo.before, updated: new Date().toISOString() })
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ---------- Coming back ----------

function RecallCard({ question, onDone }: { question: Question; onDone: (open: boolean) => void }) {
  const [shown, setShown] = useState(false)
  return (
    <section className="hole-recall panel-card" aria-label="Before you go on">
      <p className="hole-label">Before you go on</p>
      <h4>{question.text}</h4>
      {shown ? (
        <>
          <blockquote>{question.answer?.text}</blockquote>
          <div className="subject-actions">
            <button className="secondary-button" onClick={() => onDone(false)}>
              Go on
            </button>
            <button className="text-button" onClick={() => onDone(true)}>
              Open it
            </button>
          </div>
        </>
      ) : (
        <div className="subject-actions">
          <button className="secondary-button" onClick={() => setShown(true)}>
            Show what you wrote
          </button>
          <button className="text-button" onClick={() => onDone(false)}>
            Not now
          </button>
        </div>
      )}
    </section>
  )
}

// ---------- The map ----------

function HoleOutline({
  subject,
  current,
  onOpen,
  onSave,
  compact = false,
}: {
  subject: Subject
  current?: string
  onOpen: (id: string) => void
  onSave: (next: Subject, undo?: string) => void
  compact?: boolean
}) {
  const groups = holeMap(subject)
  return (
    <div className={'hole-outline' + (compact ? ' hole-outline--compact' : '')}>
      {groups.map((group) => (
        <section key={group.area?.id ?? 'all'} className="hole-group">
          {group.area ? <h5>{group.area.title}</h5> : null}
          <ul>
            {group.rows.map((row) => {
              const style = { '--depth': Math.min(row.depth, 6) } as CSSProperties
              if (row.kind === 'door') {
                if (compact) return null
                return (
                  <li key={`door-${row.from.id}-${row.door.text}`} className="hole-row hole-row--door" style={style}>
                    <button
                      onClick={() => {
                        const taken = takeDoor(subject, row.from.id, row.door)
                        if (!taken.question) return
                        onSave(taken.subject)
                        onOpen(taken.question.id)
                      }}
                    >
                      <span className="hole-mark" aria-hidden="true" />
                      <span className="hole-row-text">{row.door.text}</span>
                      <small>{DOOR_WORD[row.door.kind]}</small>
                    </button>
                  </li>
                )
              }
              const q = row.question
              const state = isExplained(q) ? 'explained' : isVisited(q) ? 'visited' : 'open'
              return (
                <li
                  key={q.id}
                  className={`hole-row hole-row--${state}`}
                  style={style}
                  aria-current={q.id === current ? 'true' : undefined}
                >
                  <button onClick={() => onOpen(q.id)}>
                    <span className="hole-mark" aria-hidden="true" />
                    <span className="hole-row-text">{q.text}</span>
                    {!compact && doorOf(q) ? <small>{DOOR_WORD[doorOf(q)!]}</small> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function HoleMapView({
  path,
  subject,
  library,
  onSave,
  onOpen,
  onOpenBook,
  onNotice,
  onClimbOut,
}: {
  path: LearningPath
  subject: Subject
  library: LibraryBook[]
  onSave: (next: Subject, undo?: string) => void
  onOpen: (id: string) => void
  onOpenBook?: (id: string) => void
  onNotice: (message: string) => void
  onClimbOut?: () => void
}) {
  const counts = holeCounts(subject)
  const resume = lastOpen(subject) ?? firstQuestion(subject)
  const [mapping, setMapping] = useState(false)
  async function mapGround() {
    setMapping(true)
    try {
      const draft = await requestSubject({ goal: path.title, level: subject.level })
      onSave(withGround(subject, draft))
    } catch (reason) {
      onNotice(problem(reason, 'Noema could not map the ground right now.'))
    } finally {
      setMapping(false)
    }
  }
  return (
    <div className="hole-map">
      {subject.from?.quote ? (
        <figure className="hole-origin">
          <blockquote>
            {subject.from.quote.length > 300 ? `${subject.from.quote.slice(0, 300)}…` : subject.from.quote}
          </blockquote>
          <figcaption>
            {subject.from.kind === 'book' && subject.from.bookId && onOpenBook ? (
              <button className="text-button" onClick={() => onOpenBook(subject.from!.bookId!)}>
                {subject.from.title}
              </button>
            ) : subject.from.kind === 'page' && subject.from.url ? (
              <a className="text-button" href={subject.from.url} target="_blank" rel="noreferrer noopener">
                {subject.from.title} <ExternalLink size={11} aria-hidden="true" />
              </a>
            ) : (
              subject.from.title
            )}
          </figcaption>
        </figure>
      ) : null}
      <Reading path={path} library={library} onOpenBook={onOpenBook} />
      <div className="hole-map-head">
        <p className="hole-facts">
          {counts.questions} {counts.questions === 1 ? 'question' : 'questions'} · {counts.explained} in your own words
        </p>
        <div className="subject-actions">
          {resume ? (
            <button className="primary-button" onClick={() => onOpen(resume.id)}>
              {isVisited(resume) ? 'Back down' : 'Begin'} <ArrowRight size={14} />
            </button>
          ) : null}
          {onClimbOut ? (
            <button className="secondary-button" onClick={onClimbOut}>
              Climb out
            </button>
          ) : null}
          {!subject.grounded ? (
            <button className="text-button" onClick={() => void mapGround()} disabled={mapping}>
              <MapIcon size={14} /> {mapping ? 'Mapping…' : 'Map the ground'}
            </button>
          ) : null}
        </div>
      </div>
      <HoleOutline subject={subject} onOpen={onOpen} onSave={onSave} />
    </div>
  )
}

// ---------- One question ----------

// The reader's books for this subject, with where they are in each.
function Reading({
  path,
  library,
  onOpenBook,
}: {
  path: LearningPath
  library: LibraryBook[]
  onOpenBook?: (id: string) => void
}) {
  const books = library.filter((book) => path.bookIds.includes(book.id))
  if (!books.length) return null
  return (
    <section className="subject-block">
      <h4>Reading</h4>
      <ul className="subject-reading">
        {books.map((book) => (
          <li key={book.id}>
            <button onClick={() => onOpenBook?.(book.id)}>
              {coverOf(book) ? (
                <img src={coverOf(book)} alt="" />
              ) : (
                <span className="subject-cover-fallback" aria-hidden="true">
                  {book.title.slice(0, 1)}
                </span>
              )}
              <span>
                <strong>{book.title}</strong>
                <small>
                  {book.author}
                  {book.progress > 0 ? ` · ${Math.round(book.progress)}%` : ''}
                </small>
              </span>
              <em>{book.progress > 0 && book.progress < 100 ? 'Continue' : 'Open'}</em>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PickCard({
  pick,
  owned,
  onToggleSave,
  onLooked,
  onOpenBook,
  onOpenHere,
}: {
  pick: Pick
  owned?: LibraryBook
  onToggleSave: () => void
  onLooked: () => void
  onOpenBook?: (id: string) => void
  onOpenHere?: () => void
}) {
  const Icon = PICK_ICON[pick.type]
  const time = minutesText(pick)
  const art = pick.type === 'book' ? pick.book?.coverUrl : pick.thumb
  return (
    <article className={`pick pick-${pick.type}`}>
      {art ? (
        <img className="pick-art" src={art} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="pick-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <div className="pick-body">
        {pick.url && onOpenHere ? (
          <span className="pick-title-row">
            <button className="pick-open-here" onClick={onOpenHere}>
              <strong>{pick.title}</strong>
            </button>
            <a
              className="pick-original"
              href={pick.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={onLooked}
              aria-label={`Open ${pick.title} on its site`}
              title="Open on its site"
            >
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </span>
        ) : pick.url ? (
          <a href={pick.url} target="_blank" rel="noreferrer noopener" onClick={onLooked}>
            <strong>{pick.title}</strong> <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : (
          <strong>{pick.title}</strong>
        )}
        <small>
          {[pick.source, time].filter(Boolean).join(' · ')}
          {pick.looked ? ' · Opened' : ''}
        </small>
        {pick.why ? <p>{pick.why}</p> : null}
        {pick.type === 'book' ? (
          <div className="pick-book-actions">
            {owned ? (
              <button className="secondary-button" onClick={() => onOpenBook?.(owned.id)}>
                <BookOpen size={13} /> In your library
              </button>
            ) : pick.book ? (
              <>
                <AtYourLibrary title={pick.book.title} author={pick.book.authors[0] ?? ''} isbn={pick.book.isbn} />
                <FreeCopyFinder book={pick.book} />
                {pick.book.buy.length ? (
                  <details className="buy-menu">
                    <summary>Buy or borrow</summary>
                    <ul>
                      {pick.book.buy.map((link) => (
                        <li key={link.store}>
                          <a href={link.url} target="_blank" rel="noreferrer noopener">
                            {link.store} <ExternalLink size={11} />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        className={`pick-save${pick.saved ? ' pick-saved' : ''}`}
        onClick={onToggleSave}
        aria-pressed={Boolean(pick.saved)}
        aria-label={pick.saved ? `Saved: ${pick.title}` : `Save ${pick.title}`}
        title={pick.saved ? 'Saved' : 'Save'}
      >
        <Bookmark size={15} fill={pick.saved ? 'currentColor' : 'none'} />
      </button>
    </article>
  )
}

const ownedBook = (library: LibraryBook[], title: string) => {
  const wanted = title.toLowerCase().split(':')[0].trim()
  return library.find((book) => book.title.toLowerCase().split(':')[0].trim() === wanted)
}

function QuestionPage({
  path,
  holes,
  subject,
  question,
  library,
  onSave,
  onBack,
  onOpen,
  onOpenHole,
  onOpenBook,
  onAsk,
  onNote,
  onNotice,
  onEdit,
  onClimbOut,
  sources,
}: {
  sources?: SourceHands
  onEdit?: EditSubject
  path: LearningPath
  holes: LearningPath[]
  subject: Subject
  question: Question
  library: LibraryBook[]
  onSave: (next: Subject, undo?: string) => void
  onBack: () => void
  onOpen: (id: string) => void
  onOpenHole?: (pathId: string, questionId: string) => void
  onOpenBook?: (id: string) => void
  onAsk?: (prompt: string) => void
  onNote?: (title: string, source: string) => void
  onNotice: (message: string) => void
  onClimbOut: () => void
}) {
  const area = subject.areas.length > 1 ? subject.areas.find((item) => item.id === question.areaId) : undefined
  // Seen before (or already answered): the answer shows at once. A first look asks for a guess first.
  const [revealed, setRevealed] = useState(() => Boolean(question.visitedAt || question.guess || question.answer))
  const [guess, setGuess] = useState(question.guess ?? '')
  const [answer, setAnswer] = useState(question.answer?.text ?? '')
  const [editing, setEditing] = useState(false)
  const [own, setOwn] = useState('')
  const [kind, setKind] = useState<'all' | PickType>('all')
  const [moreDoors, setMoreDoors] = useState(false)
  const [reading, setReading] = useState<Pick | null>(null)
  const latest = useRef({ subject, question })
  latest.current = { subject, question }
  const trail = trailOf(subject, question.id)

  const loading = useSyncExternalStore(subscribeExploring, () => isExploring(question.id))
  const failure = useSyncExternalStore(subscribeExploring, () => exploreError(question.id))
  function explore(picksOnly = false) {
    const reading = library.filter((book) => path.bookIds.includes(book.id)).map((book) => book.title)
    void exploreInto(
      {
        path,
        question,
        area: area?.title,
        level: subject.level,
        reading,
        trail: trail.map((step) => step.text),
        context: subject.from?.quote,
        picksOnly,
        fresh: picksOnly && Boolean(question.picks?.length),
      },
      onEdit ?? ((_id, change) => onSave(change(latest.current.subject))),
    )
  }

  // Opening a question marks it looked at; a question never answered asks Noema once (one use: answer and doors,
  // with its reading list on the same ticket).
  useEffect(() => {
    onSave(markVisited(subject, question.id))
    if (!question.short && !isExploring(question.id)) explore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const picks = question.picks ?? []
  const groups = groupPicks(picks)
  const doors = question.doors ?? []
  const taken = (text: string) =>
    subject.questions.find((q) => q.text.trim().toLowerCase() === text.trim().toLowerCase())
  const links = connectedHoles(holes, path.id, question, subjectOf)

  function go(door: { kind: Parameters<typeof takeDoor>[2]['kind']; text: string; hook?: string }) {
    const result = takeDoor(latest.current.subject, question.id, door)
    if (!result.question) return
    onSave(result.subject)
    setOwn('')
    onOpen(result.question.id)
  }
  async function fetchDoors() {
    setMoreDoors(true)
    try {
      const fresh = await requestDoors({
        subject: path.title,
        question: question.text,
        trail: [...subject.questions.map((q) => q.text)].slice(-30),
      })
      const kept = doors.filter((door) => taken(door.text))
      onSave(withDoors(latest.current.subject, question.id, [...kept, ...fresh.filter((door) => !taken(door.text))]))
    } catch (reason) {
      onNotice(problem(reason, 'Noema could not find more doors right now.'))
    } finally {
      setMoreDoors(false)
      noemaUsed()
    }
  }
  const reveal = () => {
    if ((question.guess ?? '') !== guess.trim())
      onSave(withQuestion(subject, { ...question, guess: guess.trim() || undefined }))
    setRevealed(true)
  }

  return (
    <article className="question-page hole-question">
      <nav className="question-trail" aria-label="How you got here">
        <button className="text-button question-back" onClick={onBack}>
          <ArrowLeft size={14} /> Map
        </button>
        {trail.map((step) => (
          <span key={step.id} className="question-trail-step">
            <ChevronRight size={13} aria-hidden="true" />
            <button className="text-button" onClick={() => onOpen(step.id)} title={step.text}>
              {step.text}
            </button>
          </span>
        ))}
      </nav>

      <header className="question-head">
        {doorOf(question) || area ? (
          <span className="question-area">
            {[doorOf(question) ? DOOR_WORD[doorOf(question)!] : '', area?.title].filter(Boolean).join(' · ')}
          </span>
        ) : null}
        <h3>{question.text}</h3>
        {question.hook ? <p className="question-hook">{question.hook}</p> : null}
        <span className="question-tools">
          {onAsk ? (
            <button
              className="question-tool"
              onClick={() => onAsk(`${question.text} (${path.title})`)}
              aria-label="Ask Noema"
              title="Ask Noema"
            >
              <NoemaIcon size={17} />
            </button>
          ) : null}
          {trail.length || subject.questions.length > 1 ? (
            <button
              className="question-tool"
              onClick={() => {
                onSave(removeQuestion(subject, question.id), 'Question removed.')
                onBack()
              }}
              aria-label="Remove this question"
              title="Remove"
            >
              <Trash2 size={16} />
            </button>
          ) : null}
        </span>
      </header>

      {!revealed ? (
        <form
          className="hole-guess q-card"
          onSubmit={(event) => {
            event.preventDefault()
            reveal()
          }}
        >
          <label htmlFor={`guess-${question.id}`}>Your guess</label>
          <input
            id={`guess-${question.id}`}
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            maxLength={300}
            enterKeyHint="go"
          />
          <div className="subject-actions">
            <button className="primary-button" type="submit">
              Show the answer
            </button>
            <button type="button" className="text-button" onClick={() => setRevealed(true)}>
              Skip
            </button>
          </div>
        </form>
      ) : (
        <>
          {question.guess ? <p className="hole-guessed">You guessed: {question.guess}</p> : null}
          <section className="q-section">
            <div className="q-card q-answer">
              {question.short ? (
                <p>{question.short}</p>
              ) : loading ? (
                <div className="q-answer-wait" aria-live="polite">
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" />
                </div>
              ) : failure ? (
                <p className="weather-error">
                  {failure}{' '}
                  <button className="text-button" onClick={() => explore()}>
                    <RotateCw size={13} /> Try again
                  </button>
                </p>
              ) : null}
              {question.short ? (
                <small className="q-caption">
                  <NoemaIcon size={12} aria-hidden="true" /> Noema
                </small>
              ) : null}
            </div>
          </section>

          <section className="q-section question-answer">
            <h4 className="q-label">In your own words</h4>
            {question.answer && !editing ? (
              <div className="q-card">
                <blockquote>{question.answer.text}</blockquote>
                <div className="subject-actions">
                  <button className="text-button" onClick={() => setEditing(true)}>
                    <Pencil size={13} /> Edit
                  </button>
                  {onNote ? (
                    <button className="text-button" onClick={() => onNote(question.text, path.title)}>
                      Add a note
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <form
                className="hole-own"
                onSubmit={(event) => {
                  event.preventDefault()
                  const words = answer.trim()
                  if (!words) {
                    if (question.answer) onSave(reopenQuestion(subject, question.id))
                  } else onSave(answerQuestion(subject, question.id, words, question.answer?.pickIds ?? []))
                  setEditing(false)
                }}
              >
                <textarea
                  rows={2}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  aria-label="In your own words"
                  maxLength={600}
                />
                <div className="subject-actions">
                  <button className="secondary-button" type="submit" disabled={!answer.trim() && !question.answer}>
                    Save
                  </button>
                  {editing ? (
                    <button type="button" className="text-button" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            )}
          </section>

          {question.useIt ? (
            <section className="q-section question-use">
              <h4 className="q-label">Use it</h4>
              <div className="q-card">
                <p>{question.useIt.text}</p>
                <div className="subject-actions">
                  {question.useIt.doneAt ? (
                    <>
                      <span className="question-use-done">
                        <Check size={14} aria-hidden="true" /> Done
                      </span>
                      <button className="text-button" onClick={() => onSave(markUsed(subject, question.id, false))}>
                        Not yet
                      </button>
                    </>
                  ) : (
                    <button className="secondary-button" onClick={() => onSave(markUsed(subject, question.id, true))}>
                      <Check size={14} /> Done
                    </button>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <section className="q-section hole-doors" aria-label="Where next">
            <h4 className="q-label">Where next</h4>
            <ul className="hole-door-list">
              {doors.map((door) => {
                const there = taken(door.text)
                return (
                  <li key={door.text}>
                    <button onClick={() => (there ? onOpen(there.id) : go(door))}>
                      <span className="hole-door-kind">{DOOR_WORD[door.kind]}</span>
                      <span className="hole-door-text">
                        <strong>{door.text}</strong>
                        {door.hook ? <small>{door.hook}</small> : null}
                      </span>
                      {there ? (
                        isExplained(there) ? (
                          <Check size={15} aria-label="In your own words" />
                        ) : (
                          <small className="hole-door-been">Been there</small>
                        )
                      ) : (
                        <ChevronRight size={16} aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
              {!doors.length && loading ? (
                <li className="hole-door-wait" aria-hidden="true">
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" />
                </li>
              ) : null}
            </ul>
            <form
              className="hole-own-door"
              onSubmit={(event) => {
                event.preventDefault()
                go({ kind: 'own', text: own })
              }}
            >
              <input
                value={own}
                onChange={(event) => setOwn(event.target.value)}
                aria-label="Your own question"
                placeholder="Your own question"
                maxLength={200}
                enterKeyHint="go"
              />
              <button className="secondary-button" type="submit" disabled={own.trim().length < 2} aria-label="Go down">
                <ArrowDown size={16} />
              </button>
            </form>
            <div className="subject-actions">
              {doors.length && !loading ? (
                <button className="text-button" onClick={() => void fetchDoors()} disabled={moreDoors}>
                  {moreDoors ? 'Finding…' : 'More doors'}
                </button>
              ) : null}
              <button className="text-button" onClick={onClimbOut}>
                Climb out
              </button>
            </div>
          </section>

          <section className="q-section question-block">
            <div className="q-label-row">
              <h4 className="q-label">Read, watch, listen</h4>
              {!loading && question.short ? (
                <button className="text-button" onClick={() => explore(true)}>
                  {picks.length ? 'More' : 'Find'}
                </button>
              ) : null}
            </div>
            {loading && !picks.length ? (
              <div className="pick-loading" aria-live="polite">
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
            ) : null}
            {groups.length > 1 ? (
              <div className="pick-filter" role="tablist" aria-label="Show">
                <button role="tab" aria-selected={kind === 'all'} onClick={() => setKind('all')}>
                  All <span>{picks.length}</span>
                </button>
                {groups.map((group) => (
                  <button
                    key={group.type}
                    role="tab"
                    aria-selected={kind === group.type}
                    onClick={() => setKind(group.type)}
                  >
                    {group.label} <span>{group.picks.length}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {groups
              .filter((group) => kind === 'all' || group.type === kind || !groups.some((item) => item.type === kind))
              .map((group) => (
                <div className="pick-group" key={group.type}>
                  <h5>{group.label}</h5>
                  <div className="pick-list">
                    {group.picks.map((pick) => (
                      <PickCard
                        key={pick.id}
                        pick={pick}
                        owned={pick.type === 'book' ? ownedBook(library, pick.title) : undefined}
                        onOpenBook={onOpenBook}
                        onToggleSave={() => onSave(updatePick(subject, question.id, pick.id, { saved: !pick.saved }))}
                        onLooked={() => {
                          if (!pick.looked) onSave(updatePick(subject, question.id, pick.id, { looked: true }))
                        }}
                        onOpenHere={
                          sourceView(pick)
                            ? () => {
                                if (!pick.looked) onSave(updatePick(subject, question.id, pick.id, { looked: true }))
                                setReading(pick)
                              }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
          </section>
          {reading ? (
            <SourceSheet
              pick={reading}
              onClose={() => setReading(null)}
              onFallIn={
                sources
                  ? (passage, title, url) => {
                      setReading(null)
                      sources.fallIn({ kind: 'page', title, quote: passage, url })
                    }
                  : undefined
              }
              onKeep={sources?.keep}
            />
          ) : null}

          {links.length && onOpenHole ? (
            <section className="q-section hole-links" aria-label="Connects to">
              <h4 className="q-label">Connects to</h4>
              <ul className="hole-door-list">
                {links.map(({ path: other, question: q }) => (
                  <li key={other.id}>
                    <button onClick={() => onOpenHole(other.id, q.id)}>
                      <span className="hole-door-kind">{other.title}</span>
                      <span className="hole-door-text">
                        <strong>{q.text}</strong>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </article>
  )
}

// ---------- Climbing out ----------

function ClimbOut({
  path,
  subject,
  onClose,
  onDone,
}: {
  path: LearningPath
  subject: Subject
  onClose: () => void
  onDone: (next: Subject, cards: number) => void
}) {
  const visited = sinceSurfaced(subject)
  const [stuck, setStuck] = useState('')
  const [drafts, setDrafts] = useState<Array<DraftCard & { keep: boolean }> | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState('')
  const passage = recallPassage(subject, visited)
  useEffect(() => {
    const away = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', away)
    return () => document.removeEventListener('keydown', away)
  }, [onClose])

  async function draft() {
    setDrafting(true)
    setError('')
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ passage, bookTitle: path.title, count: 3 }),
      })
      const result = (await response.json()) as { ok?: boolean; cards?: DraftCard[]; error?: string }
      if (!response.ok || !result.ok || !result.cards) throw new Error(result.error || 'Noema could not draft cards.')
      setDrafts(result.cards.map((card) => ({ ...card, keep: true })))
    } catch (reason) {
      setError(problem(reason, 'Noema could not draft cards.'))
    } finally {
      setDrafting(false)
      noemaUsed()
    }
  }
  function finish() {
    const chosen = (drafts ?? []).filter((card) => card.keep && card.question.trim() && card.answer.trim())
    if (chosen.length) {
      const made = chosen.map((card) =>
        newCard(
          { question: card.question.trim(), answer: card.answer.trim() },
          { source: passage.slice(0, 600), bookTitle: path.title },
        ),
      )
      writeReviewCards([...made, ...readReviewCards()])
    }
    onDone(climbOut(subject, stuck), chosen.length)
  }
  return (
    <div className="brain-backdrop" data-overlay onMouseDown={onClose}>
      <section
        className="hole-climb panel-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="climb-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h3 id="climb-title">Climbing out</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        {visited.length ? (
          <ol className="hole-climb-trail">
            {visited.map((q) => (
              <li key={q.id} className={isExplained(q) ? 'is-explained' : undefined}>
                {q.text}
              </li>
            ))}
          </ol>
        ) : null}
        <label className="hole-climb-field">
          What stuck?
          <textarea rows={2} value={stuck} onChange={(event) => setStuck(event.target.value)} maxLength={300} />
        </label>
        {passage ? (
          <div className="hole-climb-cards">
            <h4>Keep it</h4>
            {drafts ? (
              <ul>
                {drafts.map((card, index) => (
                  <li key={index}>
                    <label>
                      <input
                        type="checkbox"
                        checked={card.keep}
                        onChange={() =>
                          setDrafts((list) =>
                            list!.map((item, at) => (at === index ? { ...item, keep: !item.keep } : item)),
                          )
                        }
                      />
                      <span>
                        <strong>{card.question}</strong>
                        <small>{card.answer}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <button className="secondary-button" onClick={() => void draft()} disabled={drafting}>
                {drafting ? 'Drafting…' : 'Draft recall cards'}
              </button>
            )}
            {error ? <p className="weather-error">{error}</p> : null}
          </div>
        ) : null}
        <div className="subject-actions">
          <button className="primary-button" onClick={finish}>
            Done
          </button>
          <button className="text-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}

// ---------- What you found ----------

function FoundPage({
  path,
  subject,
  onSave,
  onOpen,
  onNotice,
}: {
  path: LearningPath
  subject: Subject
  onSave: (next: Subject, undo?: string) => void
  onOpen: (id: string) => void
  onNotice: (message: string) => void
}) {
  const found = foundIn(subject)
  const explained = subject.questions.filter(isExplained)
  const [draft, setDraft] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  async function sumUp() {
    setDrafting(true)
    try {
      const result = await requestSumUp({
        subject: path.title,
        area: path.title,
        answers: explained.map((q) => ({ question: q.text, answer: q.answer!.text })),
        questions: [],
      })
      setDraft(result.text)
    } catch (reason) {
      onNotice(problem(reason, 'Noema could not draft it right now.'))
    } finally {
      setDrafting(false)
    }
  }
  function exportIt() {
    const blob = new Blob([holeMarkdown(path, subject)], { type: 'text/markdown' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${path.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'Rabbit hole'}.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000)
  }
  if (!found.length && !subject.summary && !subject.stuck?.length)
    return <div className="empty-state">Nothing kept yet</div>
  return (
    <div className="hole-found">
      <div className="subject-actions hole-found-tools">
        {explained.length >= 2 && draft === null ? (
          <button className="secondary-button" onClick={() => void sumUp()} disabled={drafting}>
            <Pencil size={13} /> {drafting ? 'Drafting…' : subject.summary ? 'Sum it up again' : 'Sum it up'}
          </button>
        ) : null}
        <button className="text-button" onClick={exportIt}>
          <Download size={14} /> Export
        </button>
      </div>
      {draft !== null ? (
        <form
          className="hole-own"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(sumItUp(subject, draft))
            setDraft(null)
          }}
        >
          <label htmlFor="hole-sum">In your words</label>
          <textarea id="hole-sum" rows={5} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="subject-actions">
            <button className="primary-button" type="submit" disabled={!draft.trim()}>
              Keep
            </button>
            <button type="button" className="text-button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : subject.summary ? (
        <section className="hole-found-summary">
          <h4 className="q-label">In your words</h4>
          <p>{subject.summary.text}</p>
        </section>
      ) : null}
      {subject.stuck?.length ? (
        <section>
          <h4 className="q-label">What stuck</h4>
          <ul className="hole-stuck">
            {subject.stuck.map((line) => (
              <li key={line.at}>{line.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <ol className="hole-found-list">
        {found.map(({ question, picks }) => (
          <li key={question.id}>
            <button className="hole-found-q" onClick={() => onOpen(question.id)}>
              {question.text}
            </button>
            {question.guess ? <p className="hole-guessed">You guessed: {question.guess}</p> : null}
            {question.answer ? <blockquote>{question.answer.text}</blockquote> : null}
            {picks.length ? (
              <ul className="hole-found-picks">
                {picks.map((pick) => (
                  <li key={pick.id}>
                    {pick.url ? (
                      <a href={pick.url} target="_blank" rel="noreferrer noopener">
                        {pick.title}
                      </a>
                    ) : (
                      pick.title
                    )}
                    {pick.source ? <small> · {pick.source}</small> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ---------- On Home ----------

// Books for the questions looked at lately, then those questions, then the way back down the latest hole.
export function HomeQuestions({
  paths,
  library,
  onOpenBook,
  onOpenQuestion,
  onFindBook,
}: {
  paths: LearningPath[]
  library: LibraryBook[]
  onOpenBook: (book: LibraryBook) => void
  onOpenQuestion: (pathId: string, questionId: string) => void
  onFindBook: (title: string) => void
}) {
  const books = booksForNow(paths).slice(0, 8)
  const down = paths
    .map((path) => ({ path, question: lastOpen(subjectOf(path)) }))
    .filter((item): item is { path: LearningPath; question: Question } => Boolean(item.question))
    .sort((a, b) => (b.question.visitedAt ?? '').localeCompare(a.question.visitedAt ?? ''))[0]
  const questions = paths
    .flatMap((path) => nowQuestions(subjectOf(path)).map((question) => ({ path, question })))
    .filter((item) => item.question.id !== down?.question.id)
    .slice(0, 3)
  if (!books.length && !questions.length && !down) return null
  return (
    <section className="section-block home-questions" aria-label="Rabbit holes">
      <div className="section-heading">
        <div>
          <h2>Rabbit holes</h2>
        </div>
      </div>
      {down ? (
        <button className="home-down panel-card" onClick={() => onOpenQuestion(down.path.id, down.question.id)}>
          <ArrowDown size={18} aria-hidden="true" />
          <span>
            <small>Back down the rabbit hole</small>
            <strong>{down.question.text}</strong>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      {books.length ? (
        <div className="bookshelf-row">
          {books.map(({ path, question, pick }) => {
            const owned = ownedBook(library, pick.title)
            return (
              <button
                className="shelf-book"
                key={`${path.id}-${pick.id}`}
                title={`For: ${question.text}`}
                onClick={() => (owned ? onOpenBook(owned) : onFindBook(pick.title))}
              >
                <div className={'shelf-cover' + (owned ? '' : ' shelf-add-cover')}>
                  {owned && coverOf(owned) ? (
                    <img src={coverOf(owned)} alt="" />
                  ) : pick.book?.coverUrl ? (
                    <img src={pick.book.coverUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <BookOpen size={22} />
                  )}
                </div>
                <strong>{pick.title}</strong>
                {pick.source ? <span>{pick.source}</span> : null}
                <small>{owned ? (owned.progress > 0 ? 'Carry on' : 'Start') : 'Find a copy'}</small>
              </button>
            )
          })}
        </div>
      ) : null}
      {questions.length ? (
        <ul className="hole-door-list">
          {questions.map(({ path, question }) => (
            <li key={`${path.id}-${question.id}`}>
              <button onClick={() => onOpenQuestion(path.id, question.id)}>
                <span className="hole-door-kind">{path.title}</span>
                <span className="hole-door-text">
                  <strong>{question.text}</strong>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
