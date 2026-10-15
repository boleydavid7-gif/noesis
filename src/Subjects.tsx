// Subjects: a map of questions around the reader's books. The reading comes first; each question can bring a
// few things to read, watch or listen to beside it, and the reader's own answer in a sentence or two.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  ExternalLink,
  Headphones,
  Lightbulb,
  MessageCircleQuestionMark as NoemaIcon,
  Newspaper,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react'
import { FreeCopyFinder } from './PathPlanner'
import { AtYourLibrary } from './PublicLibrary'
import type { LibraryBook } from './lib/library'
import {
  AuthRequiredError,
  exploreQuestion,
  requestClarification,
  requestSubject,
  requestSumUp,
  resolveBooks,
  type Clarification,
} from './lib/pathClient'
import type { LearningPath } from './lib/pathPlan'
import {
  NOW_LIMIT,
  addArea,
  addQuestion,
  answerQuestion,
  areaState,
  canSumUp,
  comingBack,
  groupPicks,
  markCameBack,
  minutesText,
  moveQuestion,
  newId,
  nowQuestions,
  pathFromSubject,
  questionsIn,
  removeArea,
  removeQuestion,
  renameArea,
  reopenQuestion,
  shelf,
  subjectOf,
  sumUpArea,
  updatePick,
  withQuestion,
  type Pick,
  type PickType,
  type Question,
  type Subject,
} from './lib/subjects'

const LEVELS = ['New to it', 'Know the basics', 'Know it well']
const SUBJECT_EXAMPLES = [
  'Growing vegetables in a small yard',
  'How the stock market works',
  'Ancient Rome',
  'Why we sleep',
  'Writing short stories',
]

const PICK_ICON: Record<PickType, typeof BookOpen> = {
  book: BookOpen,
  read: Newspaper,
  watch: Play,
  listen: Headphones,
  try: Wrench,
}

const AREA_WORD = { new: 'Not started', exploring: 'Exploring', summed: 'Summed up' } as const

const coverOf = (book: LibraryBook) => book.coverDataUrl || book.coverUrl || ''

// ---------- Starting a subject ----------

export function SubjectStarter({
  onSave,
  onNotice,
  signedIn,
  onSignIn,
}: {
  onSave: (path: LearningPath) => void
  onNotice: (message: string) => void
  signedIn: boolean
  onSignIn: () => void
}) {
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState(LEVELS[0])
  const [clarification, setClarification] = useState<Clarification | null>(null)
  const [focus, setFocus] = useState('')
  const [status, setStatus] = useState<'idle' | 'narrowing' | 'choosing' | 'mapping'>('idle')
  const [error, setError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const run = useRef(0)

  function fail(reason: unknown, id: number) {
    if (id !== run.current) return
    setError(reason instanceof Error ? reason.message : 'Noema could not do that right now.')
    setNeedsSignIn(reason instanceof AuthRequiredError)
    setStatus(clarification ? 'choosing' : 'idle')
  }

  async function begin(event?: React.FormEvent) {
    event?.preventDefault()
    if (goal.trim().length < 3) {
      setError('Say what you are curious about.')
      return
    }
    const id = (run.current += 1)
    setError('')
    setStatus('narrowing')
    try {
      const result = await requestClarification(goal.trim())
      if (id !== run.current) return
      if (!result.broad) {
        await map('', id)
        return
      }
      setClarification(result)
      setFocus(result.focuses[0]?.title ?? '')
      setStatus('choosing')
    } catch (reason) {
      fail(reason, id)
    }
  }

  async function map(chosen: string, id = (run.current += 1)) {
    setError('')
    setStatus('mapping')
    try {
      const draft = await requestSubject({ goal: goal.trim(), focus: chosen || undefined, level })
      if (id !== run.current) return
      const path = pathFromSubject(draft, chosen ? `${goal.trim()}: ${chosen}` : goal.trim(), { level, why: undefined })
      onSave(path)
      onNotice(`Started “${path.title}”.`)
      setGoal('')
      setClarification(null)
      setFocus('')
      setStatus('idle')
    } catch (reason) {
      fail(reason, id)
    }
  }

  const busy = status === 'narrowing' || status === 'mapping'
  return (
    <section className="subject-start panel-card" aria-label="Start a subject">
      <form onSubmit={begin}>
        <h3>What are you curious about?</h3>
        {!signedIn ? (
          <p className="planner-signin">
            Noema maps a subject for you, which needs an account.{' '}
            <button type="button" className="text-button" onClick={onSignIn}>
              Sign in or create one
            </button>
          </p>
        ) : null}
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="e.g. Growing tomatoes, the French Revolution, how memory works"
          maxLength={400}
          rows={2}
          aria-label="What you are curious about"
        />
        <div className="subject-start-row">
          <label>
            You are
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              {LEVELS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            <Search size={15} /> {status === 'narrowing' ? 'Thinking…' : status === 'mapping' ? 'Mapping…' : 'Start'}
          </button>
        </div>
        {!goal && status === 'idle' ? (
          <div className="planner-examples">
            {SUBJECT_EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => setGoal(example)}>
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </form>
      {clarification && status !== 'idle' ? (
        <div className="subject-focus">
          <h4>{clarification.topic ? `${clarification.topic} covers a lot. Where to begin?` : 'Where to begin?'}</h4>
          <div className="subject-focus-list" role="radiogroup">
            {clarification.focuses.map((item) => (
              <button
                type="button"
                key={item.title}
                role="radio"
                aria-checked={focus === item.title}
                className={focus === item.title ? 'subject-focus-on' : ''}
                onClick={() => setFocus(item.title)}
              >
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
          <div className="subject-start-row">
            <button className="primary-button" onClick={() => void map(focus)} disabled={busy || !focus}>
              {status === 'mapping' ? 'Mapping…' : 'Map it'}
            </button>
            <button className="text-button" onClick={() => void map('')} disabled={busy}>
              All of it
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="weather-error" role="alert">
          {error}
          {needsSignIn ? (
            <>
              {' '}
              <button type="button" className="text-button" onClick={onSignIn}>
                Sign in
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}

// ---------- One subject ----------

type View = { kind: 'map' } | { kind: 'question'; id: string } | { kind: 'shelf' }

export function SubjectView({
  path,
  library,
  onChange,
  onOpenBook,
  onAsk,
  onNote,
  onNotice,
}: {
  path: LearningPath
  library: LibraryBook[]
  onChange: (path: LearningPath) => void
  onOpenBook?: (id: string) => void
  onAsk?: (prompt: string) => void
  onNote?: (title: string, source: string) => void
  onNotice: (message: string) => void
}) {
  const subject = useMemo(() => subjectOf(path), [path])
  const [view, setView] = useState<View>({ kind: 'map' })
  const [undo, setUndo] = useState<{ label: string; before: Subject } | null>(null)
  const topRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 7_000)
    return () => window.clearTimeout(timer)
  }, [undo])

  if (!subject) return null

  const save = (next: Subject, undoLabel?: string) => {
    if (undoLabel) setUndo({ label: undoLabel, before: subject })
    onChange({ ...path, subject: next, updated: new Date().toISOString() })
  }
  const go = (next: View) => {
    setView(next)
    window.setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20)
  }

  const question = view.kind === 'question' ? subject.questions.find((q) => q.id === view.id) : undefined

  return (
    <div className="subject" ref={topRef}>
      {view.kind !== 'question' ? (
        <div className="subject-tabs" role="tablist">
          <button role="tab" aria-selected={view.kind === 'map'} onClick={() => go({ kind: 'map' })}>
            Questions
          </button>
          <button role="tab" aria-selected={view.kind === 'shelf'} onClick={() => go({ kind: 'shelf' })}>
            Saved
          </button>
        </div>
      ) : null}
      {view.kind === 'map' || (view.kind === 'question' && !question) ? (
        <SubjectMap
          path={path}
          subject={subject}
          library={library}
          onSave={save}
          onOpen={(id) => go({ kind: 'question', id })}
          onOpenBook={onOpenBook}
          onNotice={onNotice}
        />
      ) : null}
      {view.kind === 'shelf' ? (
        <SubjectShelf subject={subject} onOpen={(id) => go({ kind: 'question', id })} onSave={save} />
      ) : null}
      {question ? (
        <QuestionPage
          key={question.id}
          path={path}
          subject={subject}
          question={question}
          library={library}
          onSave={save}
          onBack={() => go({ kind: 'map' })}
          onOpen={(id) => go({ kind: 'question', id })}
          onOpenBook={onOpenBook}
          onAsk={onAsk}
          onNote={onNote}
          onNotice={onNotice}
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

function QuestionRow({ question, area, onOpen }: { question: Question; area?: string; onOpen: () => void }) {
  return (
    <button className="subject-question" onClick={onOpen}>
      <span>
        <strong>{question.text}</strong>
        {question.hook ? <small>{question.hook}</small> : null}
        {area ? <em>{area}</em> : null}
      </span>
      <ArrowRight size={15} aria-hidden="true" />
    </button>
  )
}

function SubjectMap({
  path,
  subject,
  library,
  onSave,
  onOpen,
  onOpenBook,
  onNotice,
}: {
  path: LearningPath
  subject: Subject
  library: LibraryBook[]
  onSave: (next: Subject, undo?: string) => void
  onOpen: (id: string) => void
  onOpenBook?: (id: string) => void
  onNotice: (message: string) => void
}) {
  const now = nowQuestions(subject)
  const back = comingBack(subject)
  const [newArea, setNewArea] = useState('')
  const areaName = (id: string) => subject.areas.find((area) => area.id === id)?.title
  return (
    <>
      <Reading path={path} library={library} onOpenBook={onOpenBook} />
      {back ? (
        <section className="subject-block subject-back">
          <h4>From before</h4>
          <p className="subject-back-q">{back.text}</p>
          <blockquote>{back.answer?.text}</blockquote>
          <div className="subject-actions">
            {back.followUp ? (
              <button
                className="secondary-button"
                onClick={() => {
                  const added = addQuestion(markCameBack(subject, back.id), back.areaId, back.followUp!, 'side')
                  onSave(added.subject)
                  onNotice('Added to Later.')
                }}
              >
                <Plus size={14} /> {back.followUp}
              </button>
            ) : null}
            <button className="text-button" onClick={() => onOpen(back.id)}>
              Add to it
            </button>
            <button className="text-button" onClick={() => onSave(markCameBack(subject, back.id))}>
              Still right
            </button>
          </div>
        </section>
      ) : null}
      <section className="subject-block">
        <h4>Now</h4>
        {now.length ? (
          <div className="subject-list">
            {now.map((q) => (
              <QuestionRow key={q.id} question={q} area={areaName(q.areaId)} onOpen={() => onOpen(q.id)} />
            ))}
          </div>
        ) : (
          <p className="subject-empty">Choose up to {NOW_LIMIT} questions from the areas below.</p>
        )}
      </section>
      <section className="subject-block">
        <h4>Areas</h4>
        <div className="subject-areas">
          {subject.areas.map((area) => (
            <AreaCard
              key={area.id}
              path={path}
              subject={subject}
              areaId={area.id}
              onSave={onSave}
              onOpen={onOpen}
              onNotice={onNotice}
            />
          ))}
        </div>
        <form
          className="subject-add"
          onSubmit={(event) => {
            event.preventDefault()
            const added = addArea(subject, newArea)
            if (added.area) {
              onSave(added.subject)
              setNewArea('')
            }
          }}
        >
          <input
            value={newArea}
            onChange={(event) => setNewArea(event.target.value)}
            placeholder="Add an area"
            aria-label="New area"
            maxLength={60}
          />
          <button className="secondary-button" type="submit" disabled={!newArea.trim()}>
            Add
          </button>
        </form>
      </section>
    </>
  )
}

function AreaCard({
  path,
  subject,
  areaId,
  onSave,
  onOpen,
  onNotice,
}: {
  path: LearningPath
  subject: Subject
  areaId: string
  onSave: (next: Subject, undo?: string) => void
  onOpen: (id: string) => void
  onNotice: (message: string) => void
}) {
  const area = subject.areas.find((item) => item.id === areaId)!
  const state = areaState(subject, areaId)
  const later = questionsIn(subject, areaId, 'later')
  const answered = questionsIn(subject, areaId, 'answered')
  const nowHere = questionsIn(subject, areaId, 'now')
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(area.title)
  const [summary, setSummary] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)

  async function draftSummary() {
    setDrafting(true)
    try {
      const text = await requestSumUp({
        subject: path.title,
        area: area.title,
        answers: answered.map((q) => ({ question: q.text, answer: q.answer?.text ?? '' })),
      })
      setSummary(text)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : 'Noema could not draft a summary right now.')
      setSummary('')
    } finally {
      setDrafting(false)
    }
  }

  return (
    <details className={`subject-area subject-area-${state}`}>
      <summary>
        <span className="subject-area-mark" aria-hidden="true" />
        <span>
          <strong>{area.title}</strong>
          {area.blurb ? <small>{area.blurb}</small> : null}
        </span>
        <em>{AREA_WORD[state]}</em>
      </summary>
      <div className="subject-area-body">
        {area.summary ? (
          <div className="subject-summary">
            <h5>In your words</h5>
            <p>{area.summary.text}</p>
          </div>
        ) : null}
        {canSumUp(subject, areaId) && summary === null ? (
          <button className="secondary-button" onClick={() => void draftSummary()} disabled={drafting}>
            <Pencil size={13} /> {drafting ? 'Drafting…' : 'Sum up this area'}
          </button>
        ) : null}
        {summary !== null ? (
          <form
            className="subject-sumup"
            onSubmit={(event) => {
              event.preventDefault()
              onSave(sumUpArea(subject, areaId, summary))
              setSummary(null)
            }}
          >
            <label htmlFor={`sum-${areaId}`}>Sum up this area (a draft from your answers; change anything)</label>
            <textarea id={`sum-${areaId}`} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="subject-actions">
              <button className="primary-button" type="submit" disabled={!summary.trim()}>
                Keep
              </button>
              <button type="button" className="text-button" onClick={() => setSummary(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {nowHere.length ? <p className="subject-empty">Now: {nowHere.map((q) => q.text).join(' · ')}</p> : null}
        {later.length ? (
          <>
            <h5>Later</h5>
            <ul className="subject-later">
              {later.map((q) => (
                <li key={q.id}>
                  <button className="subject-later-text" onClick={() => onOpen(q.id)}>
                    {q.text}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      const moved = moveQuestion(subject, q.id, 'now')
                      if (moved.full) onNotice(`Now holds ${NOW_LIMIT}. Move one to Later first.`)
                      else onSave(moved.subject)
                    }}
                  >
                    Now
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {answered.length ? (
          <details className="subject-answered">
            <summary>Answered ({answered.length})</summary>
            <ul>
              {answered.map((q) => (
                <li key={q.id}>
                  <button onClick={() => onOpen(q.id)}>
                    <strong>{q.text}</strong>
                    <small>{q.answer?.text}</small>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {adding ? (
          <form
            className="subject-add"
            onSubmit={(event) => {
              event.preventDefault()
              const added = addQuestion(subject, areaId, draft)
              if (added.question) {
                onSave(added.subject)
                setDraft('')
                setAdding(false)
              }
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a question"
              autoFocus
              aria-label={`New question in ${area.title}`}
              maxLength={200}
            />
            <button className="secondary-button" type="submit" disabled={!draft.trim()}>
              Add
            </button>
          </form>
        ) : null}
        <div className="subject-area-tools">
          {renaming ? (
            <form
              className="subject-add"
              onSubmit={(event) => {
                event.preventDefault()
                onSave(renameArea(subject, areaId, name))
                setRenaming(false)
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Area name" maxLength={60} />
              <button className="secondary-button" type="submit">
                Save
              </button>
              <button type="button" className="text-button" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              {adding ? null : (
                <button className="text-button" onClick={() => setAdding(true)}>
                  <Plus size={13} /> Add a question
                </button>
              )}
              <button className="text-button" onClick={() => setRenaming(true)}>
                <Pencil size={13} /> Rename
              </button>
              {subject.areas.length > 1 ? (
                <button
                  className="text-button"
                  onClick={() => onSave(removeArea(subject, areaId), `Removed “${area.title}”. Its questions moved.`)}
                >
                  <Trash2 size={13} /> Remove area
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </details>
  )
}

// ---------- One question ----------

function PickCard({
  pick,
  owned,
  onToggleSave,
  onLooked,
  onOpenBook,
}: {
  pick: Pick
  owned?: LibraryBook
  onToggleSave: () => void
  onLooked: () => void
  onOpenBook?: (id: string) => void
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
        {pick.url ? (
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
  subject,
  question,
  library,
  onSave,
  onBack,
  onOpen,
  onOpenBook,
  onAsk,
  onNote,
  onNotice,
}: {
  path: LearningPath
  subject: Subject
  question: Question
  library: LibraryBook[]
  onSave: (next: Subject, undo?: string) => void
  onBack: () => void
  onOpen: (id: string) => void
  onOpenBook?: (id: string) => void
  onAsk?: (prompt: string) => void
  onNote?: (title: string, source: string) => void
  onNotice: (message: string) => void
}) {
  const area = subject.areas.find((item) => item.id === question.areaId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [guess, setGuess] = useState(question.guess ?? '')
  const [answer, setAnswer] = useState(question.answer?.text ?? '')
  const [editing, setEditing] = useState(!question.answer)
  const [used, setUsed] = useState<string[]>(question.answer?.pickIds ?? [])
  const [side, setSide] = useState('')
  const latest = useRef({ subject, question })
  latest.current = { subject, question }
  const asked = useRef(false)

  async function explore() {
    setLoading(true)
    setError('')
    try {
      const reading = library.filter((book) => path.bookIds.includes(book.id)).map((book) => book.title)
      const found = await exploreQuestion({
        subject: path.title,
        area: area?.title,
        question: question.text,
        level: subject.level,
        reading,
      })
      const books = await resolveBooks(found.books).catch(() => [])
      const kept = (latest.current.question.picks ?? []).filter((pick) => pick.saved)
      const seen = new Set(kept.map((pick) => (pick.url ?? pick.title).toLowerCase()))
      const fresh: Pick[] = [
        ...books.map((book) => ({
          id: newId('pick'),
          type: 'book' as const,
          title: book.title,
          source: book.authors.slice(0, 2).join(', '),
          url: book.infoUrl,
          why: book.note,
          book: { ...book, description: undefined },
        })),
        ...found.picks.map((pick) => ({ ...pick, id: newId('pick') })),
      ].filter((pick) => !seen.has((pick.url ?? pick.title).toLowerCase()))
      const current = latest.current
      onSave(
        withQuestion(current.subject, {
          ...current.question,
          hook: current.question.hook ?? found.hook,
          short: found.short ?? current.question.short,
          followUp: found.followUp ?? current.question.followUp,
          picks: [...kept, ...fresh],
        }),
      )
      if (!kept.length && !fresh.length) setError('Nothing could be confirmed this time. Try again later.')
    } catch (reason) {
      setError(
        reason instanceof AuthRequiredError
          ? 'Sign in to find things to explore.'
          : reason instanceof Error
            ? reason.message
            : 'Noema could not find things right now.',
      )
    } finally {
      setLoading(false)
    }
  }

  // The first visit to a question looks for things to explore by itself.
  useEffect(() => {
    if (asked.current || question.picks || question.state === 'answered') return
    asked.current = true
    void explore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const picks = question.picks ?? []
  const groups = groupPicks(picks)
  const change = (next: Partial<Question>) => onSave(withQuestion(subject, { ...question, ...next }))

  return (
    <article className="question-page">
      <button className="text-button question-back" onClick={onBack}>
        <ArrowLeft size={14} /> {path.title}
      </button>
      <header>
        {area ? <span className="question-area">{area.title}</span> : null}
        <h3>{question.text}</h3>
        {question.hook ? <p className="question-hook">{question.hook}</p> : null}
        <div className="subject-actions">
          {question.state === 'later' ? (
            <button
              className="secondary-button"
              onClick={() => {
                const moved = moveQuestion(subject, question.id, 'now')
                if (moved.full) onNotice(`Now holds ${NOW_LIMIT}. Move one to Later first.`)
                else onSave(moved.subject)
              }}
            >
              Move to Now
            </button>
          ) : null}
          {question.state === 'now' ? (
            <button className="text-button" onClick={() => onSave(moveQuestion(subject, question.id, 'later').subject)}>
              Move to Later
            </button>
          ) : null}
          {onAsk ? (
            <button className="text-button" onClick={() => onAsk(`${question.text} (${path.title})`)}>
              <NoemaIcon size={14} /> Ask Noema
            </button>
          ) : null}
          <button
            className="text-button"
            onClick={() => {
              onSave(removeQuestion(subject, question.id), 'Question removed.')
              onBack()
            }}
          >
            <Trash2 size={13} /> Remove
          </button>
        </div>
      </header>

      {!question.answer ? (
        <section className="question-block">
          <label htmlFor="question-guess">
            <Lightbulb size={14} aria-hidden="true" /> Your guess (optional)
          </label>
          <textarea
            id="question-guess"
            rows={2}
            value={guess}
            placeholder="What do you think, before looking?"
            onChange={(event) => setGuess(event.target.value)}
            onBlur={() => {
              if ((question.guess ?? '') !== guess.trim()) change({ guess: guess.trim() || undefined })
            }}
            maxLength={300}
          />
        </section>
      ) : null}

      {question.short ? (
        <details className="question-short">
          <summary>Short answer from Noema</summary>
          <p>{question.short}</p>
        </details>
      ) : null}

      <section className="question-block">
        <div className="question-block-head">
          <h4>Explore</h4>
          {!loading ? (
            <button className="text-button" onClick={() => void explore()}>
              <Search size={13} /> {picks.length ? 'Find others' : 'Find things'}
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="pick-loading" aria-live="polite">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
            <small>Finding and checking links…</small>
          </div>
        ) : null}
        {error ? <p className="weather-error">{error}</p> : null}
        {groups.map((group) => (
          <div className="pick-group" key={group.type}>
            <h5>{group.label}</h5>
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
              />
            ))}
          </div>
        ))}
      </section>

      <section className="question-block question-answer">
        <h4>In your own words</h4>
        {question.answer && !editing ? (
          <>
            <blockquote>{question.answer.text}</blockquote>
            <div className="subject-actions">
              <button className="text-button" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit
              </button>
              <button
                className="text-button"
                onClick={() => {
                  onSave(reopenQuestion(subject, question.id))
                  setEditing(true)
                }}
              >
                Open it again
              </button>
              {onNote ? (
                <button className="text-button" onClick={() => onNote(question.text, path.title)}>
                  Add a note
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onSave(answerQuestion(subject, question.id, answer, used))
              setEditing(false)
              onNotice('Answer kept.')
            }}
          >
            <textarea
              rows={3}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="A sentence or two, once you know"
              aria-label="Your answer"
              maxLength={600}
            />
            {picks.length ? (
              <div className="answer-sources" role="group" aria-label="Where you found it">
                {picks.map((pick) => (
                  <button
                    type="button"
                    key={pick.id}
                    aria-pressed={used.includes(pick.id)}
                    className={used.includes(pick.id) ? 'chip chip-on' : 'chip'}
                    onClick={() =>
                      setUsed((list) =>
                        list.includes(pick.id) ? list.filter((id) => id !== pick.id) : [...list, pick.id],
                      )
                    }
                  >
                    {pick.title.length > 40 ? `${pick.title.slice(0, 40)}…` : pick.title}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="subject-actions">
              <button className="primary-button" type="submit" disabled={!answer.trim()}>
                Keep answer
              </button>
              {question.answer ? (
                <button type="button" className="text-button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        )}
      </section>

      <section className="question-block">
        <h4>What this raised</h4>
        {question.followUp && !subject.questions.some((q) => q.text === question.followUp) ? (
          <button
            className="secondary-button question-follow"
            onClick={() => {
              const added = addQuestion(subject, question.areaId, question.followUp!, 'side')
              onSave(added.subject)
              onNotice('Added to Later.')
            }}
          >
            <Plus size={14} /> {question.followUp}
          </button>
        ) : null}
        <form
          className="subject-add"
          onSubmit={(event) => {
            event.preventDefault()
            const added = addQuestion(subject, question.areaId, side, 'side')
            if (added.question) {
              onSave(added.subject)
              setSide('')
              onNotice('Added to Later.')
            }
          }}
        >
          <input
            value={side}
            onChange={(event) => setSide(event.target.value)}
            placeholder="Another question"
            aria-label="Another question"
            maxLength={200}
          />
          <button className="secondary-button" type="submit" disabled={!side.trim()}>
            Add
          </button>
        </form>
        {(() => {
          const raised = subject.questions.filter(
            (q) =>
              q.origin === 'side' && q.areaId === question.areaId && q.id !== question.id && q.state !== 'answered',
          )
          return raised.length ? (
            <ul className="subject-later">
              {raised.slice(-4).map((q) => (
                <li key={q.id}>
                  <button className="subject-later-text" onClick={() => onOpen(q.id)}>
                    {q.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : null
        })()}
      </section>
    </article>
  )
}

// ---------- Saved ----------

function SubjectShelf({
  subject,
  onOpen,
  onSave,
}: {
  subject: Subject
  onOpen: (id: string) => void
  onSave: (next: Subject, undo?: string) => void
}) {
  const groups = shelf(subject)
  if (!groups.length) return <p className="subject-empty">Things you save on a question show here, by kind.</p>
  return (
    <div className="subject-shelf">
      {groups.map((group) => (
        <div className="pick-group" key={group.type}>
          <h5>{group.label}</h5>
          {group.items.map(({ pick, question }) => (
            <div key={pick.id} className="shelf-item">
              <PickCard
                pick={pick}
                onToggleSave={() => onSave(updatePick(subject, question.id, pick.id, { saved: false }), 'Unsaved.')}
                onLooked={() => {
                  if (!pick.looked) onSave(updatePick(subject, question.id, pick.id, { looked: true }))
                }}
              />
              <button className="text-button shelf-question" onClick={() => onOpen(question.id)}>
                For: {question.text}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
