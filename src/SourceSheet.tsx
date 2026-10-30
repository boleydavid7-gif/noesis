import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ExternalLink, NotebookPen, X } from 'lucide-react'
import type { Pick } from './lib/subjects'
import { PageError, playerFor, readPage, type ReadPage } from './lib/source'

// One source of a rabbit hole, read or played without leaving Noesis: a page as plain text in the reading serif, a
// video or an episode in its maker's player. A passage picked on the page can begin a hole of its own or be kept.
export function SourceSheet({
  pick,
  onClose,
  onFallIn,
  onKeep,
}: {
  pick: Pick
  onClose: () => void
  onFallIn?: (passage: string, title: string, url: string) => void
  onKeep?: (passage: string, title: string, url: string) => void
}) {
  const player = pick.url ? playerFor(pick.url) : null
  const [page, setPage] = useState<ReadPage | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const away = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', away)
    return () => document.removeEventListener('keydown', away)
  }, [onClose])

  useEffect(() => {
    if (!pick.url || playerFor(pick.url)) return
    let live = true
    readPage(pick.url)
      .then((read) => live && setPage(read))
      .catch(
        (reason) => live && setError(reason instanceof PageError ? reason.message : 'This page can’t be opened here.'),
      )
    return () => {
      live = false
    }
  }, [pick.url])

  useEffect(() => {
    if (!page) return
    const read = () => {
      const selection = window.getSelection()
      const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
      const inside = selection?.anchorNode && bodyRef.current?.contains(selection.anchorNode)
      setPicked(inside && text.length > 1 ? text.slice(0, 1_200) : '')
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [page])

  const title = page?.title || pick.title
  const original = page?.url ?? pick.url ?? ''
  const done = (act?: (passage: string, title: string, url: string) => void) => {
    if (!act || !picked) return
    act(picked, title, original)
    window.getSelection()?.removeAllRanges()
    setPicked('')
  }

  return createPortal(
    <div className="brain-backdrop hole-source-backdrop" data-overlay onMouseDown={onClose}>
      <section
        className="hole-source panel-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="hole-source-head">
          <span className="hole-source-site">{page?.site ?? pick.source}</span>
          {original ? (
            <a className="text-button" href={original} target="_blank" rel="noreferrer noopener">
              Original <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : null}
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="hole-source-body" ref={bodyRef}>
          <h3 id="source-title">{title}</h3>
          {player ? (
            <>
              {player.kind === 'audio' ? (
                <audio className="hole-source-audio" src={player.src} controls preload="metadata" />
              ) : (
                <div
                  className={'hole-source-player' + (player.kind === 'audio-frame' ? ' is-audio' : '')}
                  style={player.ratio ? { aspectRatio: player.ratio } : undefined}
                >
                  <iframe
                    src={player.src}
                    title={title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              )}
              {pick.why ? <p className="hole-source-why">{pick.why}</p> : null}
            </>
          ) : page ? (
            <article className="hole-source-text">
              <p className="hole-source-meta">{[page.byline, `${page.minutes} min`].filter(Boolean).join(' · ')}</p>
              {page.blocks.map((block, index) =>
                block.kind === 'h' ? (
                  <h4 key={index}>{block.text}</h4>
                ) : block.kind === 'quote' ? (
                  <blockquote key={index}>{block.text}</blockquote>
                ) : block.kind === 'pre' ? (
                  <pre key={index}>{block.text}</pre>
                ) : block.kind === 'li' ? (
                  <p key={index} className="is-item">
                    {block.text}
                  </p>
                ) : (
                  <p key={index}>{block.text}</p>
                ),
              )}
            </article>
          ) : error ? (
            <div className="hole-source-error" role="status">
              <p>{error}</p>
              {original ? (
                <a className="secondary-button" href={original} target="_blank" rel="noreferrer noopener">
                  Open the original <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : (
            <div className="pick-loading" aria-live="polite" aria-label="Opening">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
            </div>
          )}
        </div>
        {picked && (onFallIn || onKeep) ? (
          <div className="hole-source-pick" role="toolbar" aria-label="Passage">
            {onKeep ? (
              <button className="secondary-button" onClick={() => done(onKeep)}>
                <NotebookPen size={14} /> Keep
              </button>
            ) : null}
            {onFallIn ? (
              <button className="primary-button" onClick={() => done(onFallIn)}>
                <ArrowDown size={14} /> Fall in
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
