import { useMemo, useState } from 'react'
import { authHeaders } from './lib/auth'
import type { BrainNote } from './lib/knowledge'
import {
  dueCards,
  gradeCard,
  newCard,
  readReviewCards,
  writeReviewCards,
  type DraftCard,
  type ReviewCard,
  type ReviewRating,
} from './lib/review'

const RATINGS: Array<{ rating: ReviewRating; label: string }> = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
]

type Drafts = { noteId: string; cards: Array<DraftCard & { keep: boolean }> }

function whenDue(card: ReviewCard): string {
  return new Date(card.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ReviewPage({ notes, onNotice }: { notes: BrainNote[]; onNotice: (message: string) => void }) {
  const [cards, setCards] = useState<ReviewCard[]>(() => readReviewCards())
  const [revealed, setRevealed] = useState(false)
  const [drafting, setDrafting] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Drafts | null>(null)
  // `now` is captured when cards change so the due queue is stable while studying.
  const due = useMemo(() => dueCards(cards), [cards])
  const current = due[0]
  const upcoming = useMemo(
    () => [...cards].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).find((card) => !due.includes(card)),
    [cards, due],
  )
  const sources = useMemo(() => notes.filter((note) => note.body.trim().length >= 40).slice(0, 20), [notes])

  function save(next: ReviewCard[]) {
    setCards(next)
    writeReviewCards(next)
  }

  function grade(rating: ReviewRating) {
    if (!current) return
    save(cards.map((card) => (card.id === current.id ? gradeCard(card, rating) : card)))
    setRevealed(false)
  }

  async function draftFor(note: BrainNote) {
    setDrafting(note.id)
    setDrafts(null)
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ passage: note.body, bookTitle: note.bookTitle, count: 3 }),
      })
      const result = (await response.json()) as { ok?: boolean; cards?: DraftCard[]; error?: string }
      if (!response.ok || !result.ok || !result.cards)
        throw new Error(result.error || 'Noema could not draft questions.')
      setDrafts({ noteId: note.id, cards: result.cards.map((card) => ({ ...card, keep: true })) })
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : 'Noema could not draft questions.')
    } finally {
      setDrafting(null)
    }
  }

  function approve() {
    if (!drafts) return
    const note = notes.find((item) => item.id === drafts.noteId)
    const chosen = drafts.cards.filter((card) => card.keep && card.question.trim() && card.answer.trim())
    if (!note || chosen.length === 0) return
    const created = chosen.map((card) =>
      newCard(
        { question: card.question.trim(), answer: card.answer.trim() },
        { source: note.body.slice(0, 600), noteId: note.id, bookId: note.bookId, bookTitle: note.bookTitle },
      ),
    )
    save([...created, ...cards])
    setDrafts(null)
    onNotice(`Added ${created.length} review ${created.length === 1 ? 'card' : 'cards'}.`)
  }

  return (
    <div className="review-page">
      <section className="panel-card review-study">
        <h3>Study</h3>
        {current ? (
          <>
            <p className="review-count">
              {due.length} due · {cards.length} total
            </p>
            <p className="review-question">{current.question}</p>
            {revealed ? (
              <>
                <p className="review-answer">{current.answer}</p>
                {current.bookTitle ? <p className="review-origin">From {current.bookTitle}</p> : null}
                <div className="review-ratings">
                  {RATINGS.map(({ rating, label }) => (
                    <button key={rating} className="secondary-button" onClick={() => grade(rating)}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="primary-button" onClick={() => setRevealed(true)}>
                Show answer
              </button>
            )}
          </>
        ) : (
          <div className="empty-state">
            {cards.length === 0
              ? 'No review cards yet. Draft questions from one of your notes below.'
              : upcoming
                ? `All caught up. Next card is due ${whenDue(upcoming)}.`
                : 'All caught up.'}
          </div>
        )}
      </section>

      <section className="panel-card review-sources">
        <h3>Make cards from your notes</h3>
        <p className="review-hint">Noema drafts questions from a note. You choose which ones to keep.</p>
        {sources.length === 0 ? (
          <div className="empty-state">Save a highlight or note with a few sentences to draft questions from it.</div>
        ) : (
          sources.map((note) => (
            <div className="review-source" key={note.id}>
              <div>
                <strong>{note.title}</strong>
                {note.bookTitle ? <span> · {note.bookTitle}</span> : null}
                <p>{note.body.length > 220 ? `${note.body.slice(0, 220)}…` : note.body}</p>
                <small>
                  {cards.filter((card) => card.noteId === note.id).length === 1
                    ? '1 card'
                    : `${cards.filter((card) => card.noteId === note.id).length} cards`}
                </small>
              </div>
              <button className="secondary-button" disabled={drafting !== null} onClick={() => void draftFor(note)}>
                {drafting === note.id ? 'Drafting…' : 'Draft questions'}
              </button>
              {drafts?.noteId === note.id ? (
                <div className="review-drafts">
                  {drafts.cards.map((card, index) => (
                    <div className="review-draft" key={index}>
                      <label>
                        <input
                          type="checkbox"
                          checked={card.keep}
                          onChange={(event) =>
                            setDrafts({
                              ...drafts,
                              cards: drafts.cards.map((item, i) =>
                                i === index ? { ...item, keep: event.target.checked } : item,
                              ),
                            })
                          }
                        />
                        <span>Keep</span>
                      </label>
                      <textarea
                        value={card.question}
                        aria-label="Question"
                        onChange={(event) =>
                          setDrafts({
                            ...drafts,
                            cards: drafts.cards.map((item, i) =>
                              i === index ? { ...item, question: event.target.value } : item,
                            ),
                          })
                        }
                      />
                      <textarea
                        value={card.answer}
                        aria-label="Answer"
                        onChange={(event) =>
                          setDrafts({
                            ...drafts,
                            cards: drafts.cards.map((item, i) =>
                              i === index ? { ...item, answer: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  <div className="review-ratings">
                    <button
                      className="primary-button"
                      onClick={approve}
                      disabled={!drafts.cards.some((card) => card.keep)}
                    >
                      Add {drafts.cards.filter((card) => card.keep).length}{' '}
                      {drafts.cards.filter((card) => card.keep).length === 1 ? 'card' : 'cards'}
                    </button>
                    <button className="secondary-button" onClick={() => setDrafts(null)}>
                      Discard
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      {cards.length > 0 ? (
        <section className="panel-card review-all">
          <h3>All cards</h3>
          {cards.map((card) => (
            <div className="review-card-row" key={card.id}>
              <div>
                <strong>{card.question}</strong>
                <small>Due {whenDue(card)}</small>
              </div>
              <button
                className="secondary-button"
                aria-label={`Delete card: ${card.question}`}
                onClick={() => save(cards.filter((item) => item.id !== card.id))}
              >
                Delete
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
