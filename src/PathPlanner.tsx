import { useRef, useState } from 'react'
import { BookOpen, Check, Clock, ExternalLink, Lightbulb, Search, Sparkles, Star } from 'lucide-react'
import { requestSuggestion, resolveBooks } from './lib/pathClient'
import {
  EXAMPLE_GOALS,
  milestoneDone,
  pathFromSuggestion,
  rankBooks,
  toggleTopic,
  topicCount,
  type LearningPath,
  type PlanMilestone,
  type PlanResource,
  type ResolvedBook,
  type Suggestion,
} from './lib/pathPlan'

function Timeline({ milestones }: { milestones: PlanMilestone[] }) {
  return (
    <ol className="plan-timeline" style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}>
      {milestones.map((milestone) => (
        <li key={milestone.id} className={milestoneDone(milestone) ? 'plan-step plan-step-done' : 'plan-step'}>
          <i aria-hidden="true" />
          <span>{milestone.title}</span>
        </li>
      ))}
    </ol>
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
              </li>
            ))}
          </ul>
        </details>
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
          </a>
        </li>
      ))}
    </ul>
  )
}

// A saved path: milestones with tick-off topics, plus its books and resources.
export function PathPlanDetail({ path, onChange }: { path: LearningPath; onChange: (path: LearningPath) => void }) {
  const plan = path.plan
  if (!plan) return null
  return (
    <div className="plan-detail">
      {plan.milestones.map((milestone, index) => (
        <section
          key={milestone.id}
          className={milestoneDone(milestone) ? 'plan-milestone plan-milestone-done' : 'plan-milestone'}
        >
          <h4>
            <span>{index + 1}</span> {milestone.title}
          </h4>
          <ul>
            {milestone.topics.map((topic) => (
              <li key={topic.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={topic.done}
                    onChange={() =>
                      onChange({ ...path, plan: toggleTopic(plan, topic.id), updated: new Date().toISOString() })
                    }
                  />
                  <span>{topic.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {plan.resources.length ? (
        <div>
          <h4 className="plan-subhead">Free resources</h4>
          <ResourceList resources={plan.resources} />
        </div>
      ) : null}
      {plan.books.length ? (
        <div>
          <h4 className="plan-subhead">Books for this path</h4>
          <div className="plan-books">
            {plan.books.map((book) => (
              <BookCard key={`${book.title}-${book.isbn ?? ''}`} book={book} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function PathPlanner({
  onSave,
  onNotice,
}: {
  onSave: (path: LearningPath) => void
  onNotice: (message: string) => void
}) {
  const [goal, setGoal] = useState('')
  const [status, setStatus] = useState<'idle' | 'planning' | 'ready' | 'error'>('idle')
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [books, setBooks] = useState<ResolvedBook[]>([])
  const [lookingUp, setLookingUp] = useState(false)
  const [lookup, setLookup] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [examples, setExamples] = useState(false)
  const run = useRef(0)

  async function find(event?: React.FormEvent) {
    event?.preventDefault()
    if (goal.trim().length < 8) {
      setError('Describe what you want to learn in a sentence or two.')
      setStatus('error')
      return
    }
    const id = (run.current += 1)
    setStatus('planning')
    setError('')
    setSuggestion(null)
    setBooks([])
    setOpen(null)
    try {
      const plan = await requestSuggestion(goal.trim())
      if (id !== run.current) return
      setSuggestion(plan)
      setStatus('ready')
      setLookingUp(true)
      setLookup({ done: 0, total: plan.books.length })
      const resolved = await resolveBooks(plan.books, (_list, done, total) => {
        if (id === run.current) setLookup({ done, total })
      })
      if (id !== run.current) return
      // Show the ten best-rated of everything that was found.
      setBooks(rankBooks(resolved, 10))
      setLookingUp(false)
    } catch (reason) {
      if (id !== run.current) return
      setError(reason instanceof Error ? reason.message : 'Noema could not build a path right now.')
      setStatus('error')
      setLookingUp(false)
    }
  }

  function save(path: Suggestion['paths'][number]) {
    if (!suggestion) return
    onSave(pathFromSuggestion(suggestion, path, books))
    setSaved((current) => new Set(current).add(path.id))
    onNotice(`Saved “${path.title}” to your learning paths.`)
  }

  return (
    <section className="planner" aria-label="Create a learning path">
      <div className="planner-top">
        <form className="planner-goal panel-card" onSubmit={find}>
          <div className="planner-goal-head">
            <span className="planner-spark">
              <Sparkles size={20} />
            </span>
            <div>
              <h3>Describe your goal</h3>
              <p>Be specific or broad. Noema will design guided paths and look up real books and free resources.</p>
            </div>
          </div>
          <div className="planner-goal-body">
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. I want to understand computer networking from beginner to job-ready, with hands-on practice."
              maxLength={400}
              rows={3}
              aria-label="Your learning goal"
            />
            <div className="planner-actions">
              <button className="primary-button" type="submit" disabled={status === 'planning'}>
                <Search size={15} /> {status === 'planning' ? 'Planning…' : 'Find paths'}
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
            </p>
          ) : null}
        </form>
        <aside className="planner-why panel-card">
          <h3>
            <Lightbulb size={16} /> How these are chosen
          </h3>
          <ul>
            {[
              'Matched to your goal and level',
              'Practical, with a clear order to follow',
              'Real books found in a public catalogue',
              'Free resources whose links were checked',
              'You can edit and track every step',
            ].map((line) => (
              <li key={line}>
                <Check size={14} /> {line}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {status === 'planning' ? <p className="planner-status">Noema is designing your paths…</p> : null}

      {suggestion ? (
        <>
          <div className="planner-heading">
            <h3>Recommended paths</h3>
            <p>Each path orders what to learn, from the basics to real-world practice.</p>
          </div>
          <div className="planner-paths">
            {suggestion.paths.map((path) => {
              const expanded = open === path.id
              return (
                <article className="planner-path panel-card" key={path.id}>
                  <h4>{path.title}</h4>
                  <p>{path.summary}</p>
                  <div className="plan-meta">
                    <span>
                      <Clock size={13} /> {path.weeks}
                    </span>
                    <span>
                      <BookOpen size={13} /> {topicCount(path.milestones)} topics
                    </span>
                    <span>{path.level}</span>
                  </div>
                  <Timeline milestones={path.milestones} />
                  {expanded ? (
                    <ul className="plan-topics">
                      {path.milestones.map((milestone) => (
                        <li key={milestone.id}>
                          <strong>{milestone.title}</strong>
                          <span>{milestone.topics.map((topic) => topic.label).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
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

          <div className="planner-lower">
            <section className="planner-resources panel-card">
              <h3>Free resources</h3>
              <p>Official and free ways to get started. Each link was checked.</p>
              <ResourceList resources={suggestion.resources} />
            </section>
            <section className="planner-books panel-card">
              <h3>Top 10 books on this subject</h3>
              <p>
                Ranked by reader ratings from Google Books and Open Library, weighted so a few votes don’t beat
                thousands. Books without ratings come last.
              </p>
              {lookingUp ? (
                <p className="context-empty">
                  Finding and rating books… {lookup.done} of {lookup.total}
                </p>
              ) : null}
              <div className="plan-books">
                {books.map((book, index) => (
                  <BookCard key={`${book.title}-${book.isbn ?? ''}`} book={book} rank={index + 1} />
                ))}
              </div>
              {!lookingUp && books.length === 0 ? (
                <p className="context-empty">No matching books were found for this goal.</p>
              ) : null}
            </section>
          </div>
          <p className="planner-footnote">
            Paths are suggested by AI, so treat them as a starting point. Book details come from Google Books. Store
            links open in a new tab, and prices can differ there.
          </p>
        </>
      ) : null}
    </section>
  )
}
