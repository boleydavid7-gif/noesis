import { Check, StickyNote, Target } from 'lucide-react'

export type StudyInfo = {
  pathTitle: string
  stage: string
  stageNumber: number
  stageCount: number
  outcome?: string
  topics: Array<{ id: string; label: string; done: boolean }>
}

// What this book is for, shown beside the page: the stage, its topics, and a way to tick or write about each.
export function StudyPanel({ study, onNote }: { study: StudyInfo; onNote: (topic: string) => void }) {
  return (
    <section className="study-panel" aria-label="What you are studying">
      <div className="study-head">
        <Target size={13} />
        <span>
          {study.pathTitle} · stage {study.stageNumber} of {study.stageCount}
        </span>
      </div>
      <strong>{study.stage}</strong>
      {study.outcome ? (
        <p className="study-outcome">You’re aiming to: {study.outcome.replace(/^./, (c) => c.toLowerCase())}</p>
      ) : null}
      <ul>
        {study.topics.map((topic) => (
          <li key={topic.id} className={topic.done ? 'study-done' : ''}>
            <span className="study-topic">{topic.label}</span>
            <button
              className="plan-ask"
              onClick={() => onNote(topic.label)}
              aria-label={`Write about ${topic.label}`}
              title="Write about this"
            >
              <StickyNote size={13} />
            </button>
            {topic.done ? <Check size={12} aria-hidden="true" /> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
