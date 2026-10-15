import { HelpCircle, StickyNote } from 'lucide-react'

export type StudyInfo = {
  pathTitle: string
  questions: Array<{ id: string; text: string }>
}

// Beside the page: the questions from the reader's subject to keep in mind while reading, and a way to write
// about each.
export function StudyPanel({ study, onNote }: { study: StudyInfo; onNote: (topic: string) => void }) {
  return (
    <section className="study-panel" aria-label="Questions for this book">
      <div className="study-head">
        <HelpCircle size={13} />
        <span>{study.pathTitle}</span>
      </div>
      <strong>Questions to keep in mind</strong>
      <ul>
        {study.questions.map((question) => (
          <li key={question.id}>
            <span className="study-topic">{question.text}</span>
            <button
              className="plan-ask"
              onClick={() => onNote(question.text)}
              aria-label={`Write about ${question.text}`}
              title="Write about this"
            >
              <StickyNote size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
