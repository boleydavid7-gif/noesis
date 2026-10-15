import { useContext, useState } from 'react'
import { FreeCopyContext, findFreeCopies, type FreeCopy } from './lib/freeCopy'
import type { ResolvedBook } from './lib/pathPlan'

// Searches open sources for a free copy of the book, only when asked, and lets the
// learner open or import it straight into the reader.
export function FreeCopyFinder({ book }: { book: ResolvedBook }) {
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
