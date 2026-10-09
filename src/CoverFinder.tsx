import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { resizeCover } from './lib/libraryTools'

type Cover = { id: string; source: string; label: string; thumb: string; full: string }

const proxied = (url: string) => `/api/cover?url=${encodeURIComponent(url)}`

/** A window of cover pictures found online for a book; picking one hands it back, already shrunk to size. */
export function CoverFinder({
  title,
  author,
  onPick,
  onClose,
}: {
  title: string
  author: string
  onPick: (cover: string) => void
  onClose: () => void
}) {
  const [covers, setCovers] = useState<Cover[] | null>(null)
  const [problem, setProblem] = useState('')
  const [choosing, setChoosing] = useState('')

  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ title, author })
    fetch(`/api/covers?${query}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { covers?: Cover[]; error?: string } | null
        if (!response.ok) throw new Error(body?.error ?? 'Could not search for covers right now.')
        if (!cancelled) setCovers(body?.covers ?? [])
      })
      .catch((reason) => {
        if (cancelled) return
        setProblem(reason instanceof Error ? reason.message : 'Could not search for covers right now.')
        setCovers([])
      })
    return () => {
      cancelled = true
    }
  }, [title, author])

  async function choose(cover: Cover) {
    setChoosing(cover.id)
    setProblem('')
    try {
      const response = await fetch(proxied(cover.full))
      if (!response.ok) throw new Error('That picture would not load. Try another.')
      const blob = await response.blob()
      const dataUrl = await resizeCover(new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }))
      onPick(dataUrl)
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That picture would not load. Try another.')
      setChoosing('')
    }
  }

  return (
    <div className="brain-backdrop cover-finder-backdrop" data-overlay onMouseDown={onClose}>
      <section
        className="recovery-panel panel-card cover-finder"
        role="dialog"
        aria-label="Find a cover"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="cover-finder-head">
          <h2>Find a cover</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <p className="cover-finder-hint">Covers found for “{title}”. Choose one to use.</p>
        {problem ? <p className="cover-finder-problem">{problem}</p> : null}
        {covers === null ? <p className="cover-finder-hint">Searching…</p> : null}
        {covers?.length === 0 && !problem ? (
          <p className="cover-finder-hint">
            No covers found. Try changing the title or author, or choose a picture of your own.
          </p>
        ) : null}
        <div className="cover-finder-grid">
          {covers?.map((cover) => (
            <button
              key={cover.id}
              type="button"
              className="cover-finder-item"
              disabled={Boolean(choosing)}
              aria-label={`Use this cover from ${cover.source}${cover.label ? `: ${cover.label}` : ''}`}
              onClick={() => void choose(cover)}
            >
              <img src={proxied(cover.thumb)} alt="" />
              <small>{choosing === cover.id ? 'Using…' : cover.source}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
