import { libraryBooksForStage } from './lib/pathLink'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Clock, ExternalLink, Lightbulb, Search, Sparkles, Star, StickyNote } from 'lucide-react'
import { newCard, readReviewCards, writeReviewCards } from './lib/review'
import { FreeCopyContext, findFreeCopies, type FreeCopy } from './lib/freeCopy'
import {
  AuthRequiredError,
  requestClarification,
  requestGrade,
  requestMaterials,
  requestQuestion,
  type QuizGrade,
  requestSuggestion,
  resolveBooks,
  type Clarification,
} from './lib/pathClient'
import {
  EXAMPLE_GOALS,
  addMaterials,
  stageHours,
  withSchedule,
  milestoneDone,
  milestoneGuide,
  nextTopic,
  pathFromSuggestion,
  planProgress,
  rankBooks,
  toggleTopic,
  topicCount,
  type LearningPath,
  type PathPlan,
  type PlanMilestone,
  type PlanResource,
  type ResolvedBook,
  type SuggestedPath,
  type Suggestion,
} from './lib/pathPlan'

const totalHours = (path: SuggestedPath) => path.milestones.reduce((sum, m) => sum + stageHours(m), 0)

function Timeline({ milestones }: { milestones: PlanMilestone[] }) {
  return (
    <ol className="plan-timeline" style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}>
      {milestones.map((milestone) => (
        <li key={milestone.id} className={milestoneDone(milestone) ? 'plan-step plan-step-done' : 'plan-step'}>
          <i aria-hidden="true" />
          <span title={milestone.title}>{milestone.title}</span>
        </li>
      ))}
    </ol>
  )
}

// Searches open sources for a free copy of the book, only when asked, and lets the
// learner open or import it straight into the reader.
function FreeCopyFinder({ book }: { book: ResolvedBook }) {
  const open = useContext(FreeCopyContext)
  const [state, setState] = useState<'idle' | 'looking' | 'done' | 'error'>('idle')
  const [copies, setCopies] = useState<FreeCopy[]>([])
  if (!open) return null
  async function look() {
    setState('looking')
    try {
      setCopies(await findFreeCopies(book))
      setState('done')
    } catch {
      setState('error')
    }
  }
  return (
    <div className="plan-freecopy">
      {state === 'idle' ? (
        <button className="text-button" onClick={() => void look()}>
          Find a free copy
        </button>
      ) : null}
      {state === 'looking' ? <small>Searching open libraries…</small> : null}
      {state === 'error' ? <small>The search is unavailable right now.</small> : null}
      {state === 'done' && copies.length === 0 ? (
        <small>No free copy found. It is probably still in copyright. Buy a DRM-free copy to import it.</small>
      ) : null}
      {copies.map((copy) => (
        <button key={copy.id} className="secondary-button" onClick={() => void open(copy)}>
          {copy.readerUrl ? 'Read in Noesis' : 'Import'} · {copy.source}
        </button>
      ))}
    </div>
  )
}

export function BookCard({ book, rank }: { book: ResolvedBook; rank?: number }) {
  return (
    <article className="plan-book">
      {rank ? <span className="plan-rank">#{rank}</span> : null}
      {book.coverUrl ? (
        <img src={book.coverUrl} alt={`Cover of ${book.title}`} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="plan-book-cover-fallback" aria-hidden="true">
          {book.title.slice(0, 1)}
        </div>
      )}
      <strong title={book.title}>{book.title}</strong>
      {book.authors.length ? <small>{book.authors.slice(0, 2).join(', ')}</small> : null}
      {book.rating ? (
        <span
          className="plan-rating"
          title={`Reader rating: ${(book.ratings ?? []).map((part) => `${part.source} ${part.average.toFixed(1)} (${part.count.toLocaleString()})`).join(', ') || 'combined'}`}
        >
          <Star size={12} fill="currentColor" /> {book.rating.toFixed(1)}
          {book.ratingsCount ? <em>({book.ratingsCount.toLocaleString()})</em> : null}
        </span>
      ) : null}
      {book.note ? <span className="plan-pill">{book.note}</span> : null}
      {book.unverified ? <span className="plan-unverified">Suggested by AI, not verified</span> : null}
      <div className="plan-book-actions">
        <details className="buy-menu">
          <summary>{book.price ? `Buy · e-book ${book.price}` : 'Buy or borrow'}</summary>
          <ul>
            {book.buy.map((link) => (
              <li key={link.store}>
                <a href={link.url} target="_blank" rel="noreferrer noopener">
                  {link.store} <ExternalLink size={11} />
                </a>
                {link.note ? <small>{link.note}</small> : null}
              </li>
            ))}
            <li className="plan-buy-note">Only files with no copy protection can be imported into Noesis.</li>
          </ul>
        </details>
        <FreeCopyFinder book={book} />
        {book.freeUrl ? (
          <a className="plan-free" href={book.freeUrl} target="_blank" rel="noreferrer noopener">
            Free copy
          </a>
        ) : null}
      </div>
    </article>
  )
}

export function ResourceList({ resources }: { resources: PlanResource[] }) {
  if (resources.length === 0)
    return <p className="context-empty">No verified free resources were found for this goal.</p>
  return (
    <ul className="plan-resources">
      {resources.map((resource) => (
        <li key={resource.url}>
          <a href={resource.url} target="_blank" rel="noreferrer noopener">
            <span>
              <strong>
                {resource.title} <ExternalLink size={11} />
              </strong>
              <small>{[resource.publisher, resource.note].filter(Boolean).join(' · ')}</small>
            </span>
            <em>{resource.kind}</em>
            {resource.note ? <small className="plan-why">Why: {resource.note}</small> : null}
          </a>
        </li>
      ))}
    </ul>
  )
}

function StudyWith({
  plan,
  milestone,
  library = [],
  onOpenBook,
}: {
  plan: PathPlan
  milestone: PlanMilestone
  library?: Array<{ id: string; title: string; author?: string }>
  onOpenBook?: (id: string) => void
}) {
  const { resources, books } = milestoneGuide(plan, milestone)
  const owned = libraryBooksForStage(milestone, library)
  if (resources.length === 0 && books.length === 0 && owned.length === 0) return null
  return (
    <div className="plan-study">
      <strong>Study with</strong>
      <ul>
        {onOpenBook
          ? owned.map((book) => (
              <li key={`own-${book.id}`}>
                <button className="text-button" onClick={() => onOpenBook(book.id)}>
                  Open “{book.title}” from your library
                </button>
              </li>
            ))
          : null}
        {resources.map((resource) => (
          <li key={resource.url}>
            <a href={resource.url} target="_blank" rel="noreferrer noopener">
              {resource.title} <ExternalLink size={11} />
            </a>
            <em>{resource.kind}</em>
          </li>
        ))}
        {books.map((book) => (
          <li key={book.title}>
            <details className="buy-menu plan-study-book">
              <summary>{book.title}</summary>
              <ul>
                {book.buy.map((link) => (
                  <li key={link.store}>
                    <a href={link.url} target="_blank" rel="noreferrer noopener">
                      {link.store} <ExternalLink size={11} />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
            <em>Book</em>
            {book.note ? <small className="plan-why">Why: {book.note}</small> : null}
            <FreeCopyFinder book={book} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// A short check on one topic: Noema asks, the learner answers in their own words,
// and a good answer can become a review card so it sticks.
function TopicCheck({
  plan,
  stage,
  topic,
  onPassed,
}: {
  plan: PathPlan
  stage: string
  topic: string
  onPassed: () => void
}) {
  const [state, setState] = useState<'idle' | 'asking' | 'answering' | 'grading' | 'graded'>('idle')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [grade, setGrade] = useState<QuizGrade | null>(null)
  const [error, setError] = useState('')
  const [cardSaved, setCardSaved] = useState(false)
  const base = { goal: plan.goal, stage, topic, level: plan.level }

  async function ask() {
    setState('asking')
    setError('')
    setAnswer('')
    setGrade(null)
    setCardSaved(false)
    try {
      setQuestion(await requestQuestion(base))
      setState('answering')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Noema could not write a question right now.')
      setState('idle')
    }
  }
  async function check() {
    setState('grading')
    setError('')
    try {
      setGrade(await requestGrade({ ...base, question, answer }))
      setState('graded')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Noema could not check that right now.')
      setState('answering')
    }
  }
  function keepCard() {
    if (!grade) return
    const card = newCard({ question, answer: grade.ideal || answer }, { source: `${stage} · ${topic}` })
    writeReviewCards([card, ...readReviewCards()])
    setCardSaved(true)
  }

  if (state === 'idle')
    return (
      <div className="topic-check">
        <button className="secondary-button" onClick={() => void ask()}>
          <Sparkles size={14} /> Check yourself
        </button>
        {error ? (
          <p className="weather-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  return (
    <div className="topic-check topic-check-open">
      <p className="topic-check-question">{state === 'asking' ? 'Writing a question…' : question}</p>
      {state === 'answering' || state === 'grading' ? (
        <>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={3}
            placeholder="Answer in your own words"
            aria-label="Your answer"
            disabled={state === 'grading'}
          />
          {error ? (
            <p className="weather-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="plan-next-actions">
            <button
              className="primary-button"
              onClick={() => void check()}
              disabled={state === 'grading' || answer.trim().length < 2}
            >
              {state === 'grading' ? 'Checking…' : 'Check answer'}
            </button>
            <button className="text-button" onClick={() => setState('idle')}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {state === 'graded' && grade ? (
        <>
          <p className={`topic-check-verdict topic-check-${grade.verdict}`}>
            {grade.verdict === 'correct' ? 'Correct.' : grade.verdict === 'partly' ? 'Partly right.' : 'Not quite.'}{' '}
            {grade.feedback}
          </p>
          {grade.ideal ? (
            <p className="topic-check-ideal">
              <strong>A good answer:</strong> {grade.ideal}
            </p>
          ) : null}
          <div className="plan-next-actions">
            {grade.verdict !== 'incorrect' ? (
              <button className="primary-button" onClick={onPassed}>
                <Check size={14} /> Mark done
              </button>
            ) : null}
            <button className="secondary-button" onClick={() => void ask()}>
              Another question
            </button>
            <button className="secondary-button" onClick={keepCard} disabled={cardSaved}>
              {cardSaved ? 'Added to review' : 'Add to review'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

// A saved path. It tells the learner where to begin and what comes next, opens
// only the stage they are on, and attaches the right materials to each stage.
export function PathPlanDetail({
  path,
  onChange,
  onAsk,
  onNote,
  library,
  onOpenBook,
}: {
  library?: Array<{ id: string; title: string; author?: string; progress?: number; finished?: string }>
  onOpenBook?: (id: string) => void
  path: LearningPath
  onChange: (path: LearningPath) => void
  onAsk?: (prompt: string) => void
  onNote?: (title: string, source: string) => void
}) {
  const plan = path.plan
  const [finding, setFinding] = useState<string | null>(null)
  const [findError, setFindError] = useState('')
  if (!plan) return null
  const next = nextTopic(plan)
  const { done } = planProgress(plan)
  const tick = (topicId: string) =>
    onChange({ ...path, plan: toggleTopic(plan, topicId), updated: new Date().toISOString() })
  // Asks Noema for books and free resources for one stage, checks them, and
  // keeps them on the saved plan.
  async function findFor(milestone: PlanMilestone) {
    setFinding(milestone.id)
    setFindError('')
    try {
      const found = await requestMaterials({
        goal: plan!.goal,
        stage: milestone.title,
        topics: milestone.topics.map((topic) => topic.label),
        level: plan!.level,
      })
      const books = await resolveBooks(found.books)
      if (books.length === 0 && found.resources.length === 0)
        throw new Error('Nothing verifiable turned up. Try again.')
      onChange({
        ...path,
        plan: addMaterials(plan!, milestone.id, books, found.resources),
        updated: new Date().toISOString(),
      })
    } catch (reason) {
      setFindError(reason instanceof Error ? reason.message : 'Noema could not find materials right now.')
    } finally {
      setFinding(null)
    }
  }
  const explain = (topic: string) =>
    onAsk?.(
      `Explain “${topic}” for someone working toward this goal: ${plan.goal}. Keep it beginner friendly, then suggest one small way to practice it.`,
    )
  return (
    <div className="plan-detail">
      <section className="plan-next" aria-label={done === 0 ? 'Where to start' : 'What to do next'}>
        {next ? (
          <>
            <p className="plan-next-label">Suggested next</p>
            <h4>{next.topic.label}</h4>
            <p className="plan-next-where">
              Stage {next.milestoneIndex + 1} of {plan.milestones.length}: {next.milestone.title}
              {next.milestone.timeframe ? ` · ${next.milestone.timeframe}` : ''}
            </p>
            {done === 0 ? (
              <ol className="plan-how">
                <li>
                  {milestoneGuide(plan, next.milestone).books.length +
                  milestoneGuide(plan, next.milestone).resources.length
                    ? 'Start with one of the materials below.'
                    : 'Use Find materials to get books and links for this stage.'}
                </li>
                <li>Work through the topics in order.</li>
                <li>
                  {next.milestone.outcome
                    ? `You’re ready for the next stage when you can: ${next.milestone.outcome.replace(/^./, (c) => c.toLowerCase())}`
                    : 'Move on when you feel ready.'}
                </li>
              </ol>
            ) : null}
            <StudyWith plan={plan} milestone={next.milestone} library={library} onOpenBook={onOpenBook} />
            {findError ? (
              <p className="weather-error" role="alert">
                {findError}
              </p>
            ) : null}
            <TopicCheck
              key={next.topic.id}
              plan={plan}
              stage={next.milestone.title}
              topic={next.topic.label}
              onPassed={() => tick(next.topic.id)}
            />
            <div className="plan-next-actions">
              <button
                className="secondary-button"
                onClick={() => void findFor(next.milestone)}
                disabled={finding !== null}
              >
                <Search size={14} /> {finding === next.milestone.id ? 'Finding…' : 'Find materials for this stage'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="plan-next-label">Path complete</p>
            <h4>All topics done.</h4>
            <p className="plan-next-where">Make review questions from what you learned, then start another path.</p>
          </>
        )}
      </section>
      {plan.milestones.map((milestone, index) => {
        const finished = milestoneDone(milestone)
        const current = next?.milestoneIndex === index
        return (
          <details
            key={milestone.id}
            className={`plan-milestone${finished ? ' plan-milestone-done' : ''}${current ? ' plan-milestone-current' : ''}`}
            open={current}
          >
            <summary>
              <span className="plan-num">{finished ? <Check size={13} /> : index + 1}</span>
              <span className="plan-milestone-title">
                {milestone.title}
                {milestone.timeframe ? <small>{milestone.timeframe}</small> : null}
              </span>
              <span className="plan-status">{finished ? 'Done' : current ? 'Current' : 'Upcoming'}</span>
            </summary>
            {milestone.outcome ? (
              <p className="plan-outcome">
                By the end you can: {milestone.outcome.replace(/^./, (c) => c.toLowerCase())}
              </p>
            ) : null}
            <ul>
              {milestone.topics.map((topic) => (
                <li key={topic.id}>
                  <span className="plan-topic">{topic.label}</span>
                  {onAsk ? (
                    <button
                      className="plan-ask"
                      onClick={() => explain(topic.label)}
                      aria-label={`Ask Noema about ${topic.label}`}
                      title="Ask Noema to explain this"
                    >
                      <Sparkles size={13} />
                    </button>
                  ) : null}
                  {onNote ? (
                    <button
                      className="plan-ask"
                      onClick={() => onNote(topic.label, `${path.title} · ${milestone.title}`)}
                      aria-label={`Add a note about ${topic.label}`}
                      title="Add a note"
                    >
                      <StickyNote size={13} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {!current ? (
              <StudyWith plan={plan} milestone={milestone} library={library} onOpenBook={onOpenBook} />
            ) : null}
            {!current ? (
              <button className="text-button" onClick={() => void findFor(milestone)} disabled={finding !== null}>
                {finding === milestone.id ? 'Finding…' : 'Find materials for this stage'}
              </button>
            ) : null}
          </details>
        )
      })}
      {plan.resources.length ? (
        <div>
          <h4 className="plan-subhead">All free resources</h4>
          <ResourceList resources={plan.resources} />
        </div>
      ) : null}
      {plan.books.length ? (
        <div>
          <h4 className="plan-subhead">Books for this path</h4>
          <div className="plan-books">
            {plan.books.map((book, index) => (
              <BookCard key={`${book.title}-${book.isbn ?? ''}`} book={book} rank={index + 1} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const LEVELS = ['Complete beginner', 'Know the basics', 'Experienced']
const PURPOSES = ['Curiosity', 'Career or job', 'School or an exam', 'A specific project']
const HOURS = [2, 4, 6, 10, 15]

function MiniBooks({ books, loading }: { books: ResolvedBook[]; loading: boolean }) {
  return (
    <div className="path-reads">
      <h5>Most Popular Reads</h5>
      {books.length ? (
        <ol>
          {books.slice(0, 5).map((book) => (
            <li key={`${book.title}-${book.isbn ?? ''}`}>
              <span>
                <strong title={book.title}>{book.title}</strong>
                <small>{book.authors.slice(0, 2).join(', ')}</small>
              </span>
              {book.rating ? (
                <em>
                  <Star size={11} fill="currentColor" /> {book.rating.toFixed(1)}
                </em>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="context-empty">{loading ? 'Finding books…' : 'No matching books were found.'}</p>
      )}
    </div>
  )
}

const PLANNER_KEY = 'noesis:planner:v1'
const PLANNER_DAYS = 7

type PlannerMemory = {
  at: number
  goal: string
  clarification: Clarification | null
  picked: string
  level: string
  purpose: string
  hours: number
  suggestion: Suggestion | null
  booksByPath: Record<string, ResolvedBook[]>
  saved: string[]
}

// The planner keeps its last session so leaving the page doesn't throw away a plan.
function readPlannerMemory(): PlannerMemory | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLANNER_KEY) ?? 'null') as PlannerMemory | null
    if (!parsed || typeof parsed.goal !== 'string' || Date.now() - parsed.at > PLANNER_DAYS * 86_400_000) return null
    return parsed
  } catch {
    return null
  }
}

export function PathPlanner({
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
  const [memory] = useState(readPlannerMemory)
  const [goal, setGoal] = useState(memory?.goal ?? '')
  const [status, setStatus] = useState<'idle' | 'clarifying' | 'asking' | 'planning' | 'ready' | 'error'>(
    memory?.suggestion ? 'ready' : memory?.clarification ? 'asking' : 'idle',
  )
  const [clarification, setClarification] = useState<Clarification | null>(memory?.clarification ?? null)
  const [picked, setPicked] = useState(memory?.picked ?? '')
  const [level, setLevel] = useState(memory?.level ?? LEVELS[0])
  const [purpose, setPurpose] = useState(memory?.purpose ?? PURPOSES[0])
  const [hours, setHours] = useState(memory?.hours ?? 4)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(memory?.suggestion ?? null)
  const [booksByPath, setBooksByPath] = useState<Record<string, ResolvedBook[]>>(memory?.booksByPath ?? {})
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set(memory?.saved ?? []))
  const [examples, setExamples] = useState(false)
  const run = useRef(0)

  useEffect(() => {
    try {
      const empty = !goal && !clarification && !suggestion
      if (empty) localStorage.removeItem(PLANNER_KEY)
      else
        localStorage.setItem(
          PLANNER_KEY,
          JSON.stringify({
            at: Date.now(),
            goal,
            clarification,
            picked,
            level,
            purpose,
            hours,
            suggestion,
            booksByPath,
            saved: [...saved],
          } satisfies PlannerMemory),
        )
    } catch {
      // Remembering the plan is a convenience.
    }
  }, [goal, clarification, picked, level, purpose, hours, suggestion, booksByPath, saved])

  const paths = useMemo(
    () => (suggestion ? suggestion.paths.map((path) => withSchedule(path, hours)) : []),
    [suggestion, hours],
  )

  function fail(reason: unknown, id: number, fallback: string) {
    if (id !== run.current) return
    setError(reason instanceof Error ? reason.message : fallback)
    setNeedsSignIn(reason instanceof AuthRequiredError)
    setStatus('error')
    setLookingUp(false)
  }

  function reset() {
    run.current += 1
    setSuggestion(null)
    setBooksByPath({})
    setClarification(null)
    setPicked('')
    setOpen(null)
    setError('')
    setNeedsSignIn(false)
    setSaved(new Set())
  }

  // Step 1: find out what the learner means before planning anything.
  async function clarify(event?: React.FormEvent) {
    event?.preventDefault()
    if (goal.trim().length < 3) {
      setError('Tell Noema what you want to learn.')
      setStatus('error')
      return
    }
    reset()
    const id = run.current
    setStatus('clarifying')
    try {
      const result = await requestClarification(goal.trim())
      if (id !== run.current) return
      setClarification(result)
      setPicked(result.focuses[0]?.title ?? '')
      setStatus('asking')
    } catch (reason) {
      fail(reason, id, 'Noema could not narrow that down right now.')
    }
  }

  // Step 2: build one path per chosen focus, each with its own books.
  async function build(skip = false) {
    const id = (run.current += 1)
    setStatus('planning')
    setError('')
    setSuggestion(null)
    setBooksByPath({})
    setOpen(null)
    try {
      const plan = await requestSuggestion(goal.trim(), {
        focuses: skip || !picked ? [] : [picked],
        level: skip ? undefined : level,
        purpose: skip ? undefined : purpose,
      })
      if (id !== run.current) return
      setSuggestion(plan)
      setStatus('ready')
      await loadBooks(plan, id)
    } catch (reason) {
      fail(reason, id, 'Noema could not build a path right now.')
    }
  }

  // Looks up each path's own books, filling its card in as soon as they arrive.
  async function loadBooks(plan: Suggestion, id: number) {
    setLookingUp(true)
    for (const path of plan.paths) {
      const found = await resolveBooks(path.books ?? [])
      if (id !== run.current) return
      const seen = new Set<string>()
      const unique = found.filter((book) => !seen.has(book.title.toLowerCase()) && seen.add(book.title.toLowerCase()))
      setBooksByPath((current) => ({ ...current, [path.id]: rankBooks(unique, 10) }))
    }
    setLookingUp(false)
  }

  // A restored plan whose books never finished loading picks up where it left off.
  useEffect(() => {
    if (!memory?.suggestion) return
    const plan = memory.suggestion
    if (plan.paths.every((path) => memory.booksByPath[path.id])) return
    void loadBooks(plan, run.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function save(path: SuggestedPath) {
    if (!suggestion) return
    onSave(pathFromSuggestion(suggestion, path, booksByPath[path.id] ?? [], undefined, hours))
    setSaved((current) => new Set(current).add(path.id))
    onNotice(`Saved “${path.title}” to your learning paths.`)
  }

  const busy = status === 'clarifying' || status === 'planning'

  return (
    <section className="planner" aria-label="Create a learning path">
      <div className="planner-top">
        <form className="planner-goal panel-card" onSubmit={clarify}>
          <div className="planner-goal-head">
            <span className="planner-spark">
              <Sparkles size={20} />
            </span>
            <div>
              <h3>What do you want to learn?</h3>
            </div>
          </div>
          {!signedIn ? (
            <p className="planner-signin">
              Planning uses Noema, which needs an account.{' '}
              <button type="button" className="text-button" onClick={onSignIn}>
                Sign in or create one
              </button>
            </p>
          ) : null}
          <div className="planner-goal-body">
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. Psychology, or: I want to understand computer networking and become job-ready."
              maxLength={400}
              rows={3}
              aria-label="Your learning goal"
            />
            <div className="planner-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                <Search size={15} /> {status === 'clarifying' ? 'Thinking…' : 'Continue'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setExamples((value) => !value)}
                aria-expanded={examples}
              >
                <Lightbulb size={15} /> Browse examples
              </button>
            </div>
          </div>
          {examples ? (
            <div className="planner-examples">
              {EXAMPLE_GOALS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setGoal(example)
                    setExamples(false)
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}
          {status === 'error' && error ? (
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
        </form>
      </div>

      {clarification && (status === 'asking' || status === 'planning' || status === 'ready' || status === 'error') ? (
        <section className="planner-clarify panel-card" aria-label="Tell Noema more">
          <h3>
            {clarification.broad && clarification.topic
              ? `${clarification.topic} covers a lot. What do you want to focus on?`
              : 'Pick a focus'}
          </h3>
          <p>Pick one to see what it covers.</p>
          <div className="planner-focuses">
            {clarification.focuses.map((focus, index) => {
              const on = picked === focus.title
              return (
                <button
                  type="button"
                  key={focus.title}
                  className={on ? 'planner-focus planner-focus-on' : 'planner-focus'}
                  aria-pressed={on}
                  onClick={() => setPicked(focus.title)}
                >
                  <strong>
                    {on ? <Check size={13} /> : null} {focus.title}
                  </strong>
                  {index === 0 ? <span className="plan-pill">Good place to start</span> : null}
                  {on ? null : <small>{focus.description}</small>}
                </button>
              )
            })}
          </div>
          {(() => {
            const chosen = clarification.focuses.find((focus) => focus.title === picked)
            if (!chosen) return null
            return (
              <div className="planner-explain" aria-live="polite">
                <h4>{chosen.title}</h4>
                <p>{chosen.description}</p>
                {chosen.covers?.length ? (
                  <p>
                    <strong>You’d study:</strong> {chosen.covers.join(' · ')}
                  </p>
                ) : null}
                {chosen.fits ? (
                  <p>
                    <strong>Good for:</strong> {chosen.fits}
                  </p>
                ) : null}
              </div>
            )
          })()}
          <div className="planner-questions">
            <label>
              Your level
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                {LEVELS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Why you’re learning
              <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
                {PURPOSES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Hours per week
              <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
                {HOURS.map((item) => (
                  <option key={item} value={item}>
                    {item} hours
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="planner-actions">
            <button className="primary-button" onClick={() => void build()} disabled={busy || !picked}>
              <Sparkles size={15} /> {status === 'planning' ? 'Building…' : 'Build this path'}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                reset()
                setStatus('idle')
              }}
              disabled={busy}
            >
              None of these, start over
            </button>
            <button className="text-button" onClick={() => void build(true)} disabled={busy}>
              Skip, suggest a few paths
            </button>
          </div>
        </section>
      ) : null}

      {status === 'planning' ? <p className="planner-status">Building your path…</p> : null}

      {suggestion ? (
        <>
          <div className="planner-heading">
            <h3>Recommended paths</h3>
            <p>Estimates assume {hours} hours a week. Change it above.</p>
          </div>
          <div className="planner-paths">
            {paths.map((path) => {
              const expanded = open === path.id
              const own = booksByPath[path.id] ?? []
              return (
                <article className="planner-path panel-card" key={path.id}>
                  <h4>{path.title}</h4>
                  <p>{path.summary}</p>
                  <div className="plan-meta">
                    <span title={`${totalHours(path)} study hours at ${hours} hours a week`}>
                      <Clock size={13} /> {path.weeks}
                    </span>
                    <span>
                      <BookOpen size={13} /> {topicCount(path.milestones)} topics
                    </span>
                    <span>{path.level}</span>
                  </div>
                  <Timeline milestones={path.milestones} />
                  <MiniBooks books={own} loading={lookingUp} />
                  {expanded ? (
                    <>
                      <ul className="plan-topics">
                        {path.milestones.map((milestone) => (
                          <li key={milestone.id}>
                            <strong>
                              {milestone.title}
                              {milestone.timeframe ? ` · ${milestone.timeframe}` : ''}
                            </strong>
                            {milestone.outcome ? <em>{milestone.outcome}</em> : null}
                            <span>{milestone.topics.map((topic) => topic.label).join(' · ')}</span>
                            {milestoneGuide({ books: own, resources: [] }, milestone).books.length ? (
                              <small className="plan-stage-books">
                                Read:{' '}
                                {milestoneGuide({ books: own, resources: [] }, milestone)
                                  .books.map((b) => b.title)
                                  .join(' · ')}
                              </small>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {own.length > 0 ? (
                        <div className="plan-books">
                          {own.map((book, index) => (
                            <BookCard key={`${book.title}-${book.isbn ?? ''}`} book={book} rank={index + 1} />
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="planner-path-actions">
                    {saved.has(path.id) ? (
                      <span className="plan-saved">
                        <Check size={14} /> Saved to your paths
                      </span>
                    ) : (
                      <button className="primary-button" onClick={() => save(path)} disabled={lookingUp}>
                        {lookingUp ? 'Finding books…' : 'Save path'}
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => setOpen(expanded ? null : path.id)}
                      aria-expanded={expanded}
                    >
                      {expanded ? 'Hide details' : 'View details'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>

          <section className="planner-resources panel-card">
            <h3>Free resources</h3>

            <ResourceList resources={suggestion.resources} />
          </section>
          <p className="planner-footnote">
            Paths are AI suggestions. Study hours are estimates, and weeks are those hours divided by your hours per
            week. Book details come from Google Books and Open Library.
          </p>
        </>
      ) : null}
    </section>
  )
}
