// Reads a PDF on the page itself, so text can be selected, searched and highlighted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, Search } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { HIGHLIGHT_COLORS, type BrainNoteLocation, type HighlightColor } from './lib/knowledge'
import { findInPages, type PdfRect } from './lib/pdfMarks'

export type PdfHighlight = { id: string; color: HighlightColor; page: number; rects: PdfRect[] }

type Pick = {
  text: string
  page: number
  rects: PdfRect[]
  noteId?: string
  color?: HighlightColor
}

type Props = {
  data: ArrayBuffer
  book: { id: string; title: string; author: string }
  highlights: PdfHighlight[]
  startPage: number
  jumpPage?: number
  theme: 'paper' | 'sepia' | 'night' | 'contrast'
  onPage: (page: number, total: number) => void
  onHighlight: (text: string, color: HighlightColor, location: BrainNoteLocation) => void
  onHighlightEdit: (noteId: string, color: HighlightColor | null) => void
  onNote: (text: string, location: BrainNoteLocation) => void
  onAsk: (text: string, location: BrainNoteLocation) => void
}

type Size = { width: number; height: number }

export function PdfReader(props: Props) {
  const { data, book, highlights, startPage, jumpPage, theme, onPage } = props
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef<Array<HTMLDivElement | null>>([])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [sizes, setSizes] = useState<Size[]>([])
  const [zoom, setZoom] = useState(1)
  const [available, setAvailable] = useState(800)
  const [page, setPage] = useState(startPage)
  const [pick, setPick] = useState<Pick | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ page: number; snippet: string }> | null>(null)
  const [searching, setSearching] = useState(false)
  const [outline, setOutline] = useState<Array<{ title: string; dest: unknown }>>([])
  const texts = useRef<string[]>([])
  const restored = useRef(false)

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        loaded = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise
        if (cancelled) {
          void loaded.destroy()
          return
        }
        setDoc(loaded)
        // Page sizes first, so the scroll bar is right before any page is drawn.
        const found: Size[] = []
        for (let index = 1; index <= loaded.numPages; index += 1) {
          const pageProxy = await loaded.getPage(index)
          const view = pageProxy.getViewport({ scale: 1 })
          found.push({ width: view.width, height: view.height })
          if (cancelled) return
          if (index === 1 || index % 40 === 0 || index === loaded.numPages) setSizes([...found])
        }
        const raw = await loaded.getOutline().catch(() => null)
        if (!cancelled && raw) {
          setOutline(
            raw
              .slice(0, 80)
              .filter((item) => item.title)
              .map((item) => ({ title: item.title, dest: item.dest })),
          )
        }
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error && /password/i.test(reason.message)
              ? 'This PDF is password protected.'
              : 'This PDF could not be opened.',
          )
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
    }
  }, [data])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setAvailable(Math.max(280, element.clientWidth - 24))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scaleFor = useCallback((size: Size) => (Math.min(available, 1100) / size.width) * zoom, [available, zoom])

  const goTo = useCallback((target: number) => {
    const element = pageEls.current[target - 1]
    const holder = scroller.current
    if (!element || !holder) return
    holder.scrollTo({ top: element.offsetTop - 8 })
  }, [])

  // Back to the saved place once the first sizes are known, and again when told to jump.
  useEffect(() => {
    if (!doc || sizes.length === 0 || restored.current) return
    if (startPage > 1 && sizes.length < startPage) return
    restored.current = true
    window.requestAnimationFrame(() => goTo(startPage))
  }, [doc, sizes.length, startPage, goTo])
  useEffect(() => {
    if (jumpPage && restored.current) goTo(jumpPage)
  }, [jumpPage, goTo])

  // Which page is in view.
  const onScroll = useCallback(() => {
    const holder = scroller.current
    if (!holder) return
    const line = holder.scrollTop + holder.clientHeight / 3
    let current = 1
    for (let index = 0; index < pageEls.current.length; index += 1) {
      const element = pageEls.current[index]
      if (element && element.offsetTop <= line) current = index + 1
      else if (element) break
    }
    setPage(current)
  }, [])
  const lastReported = useRef(0)
  useEffect(() => {
    if (!doc || page === lastReported.current) return
    lastReported.current = page
    onPage(page, doc.numPages)
  }, [page, doc, onPage])

  // Selecting text offers the highlight colours.
  const checkSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const text = selection.toString().replace(/\s+/g, ' ').trim()
    if (text.length < 2) return
    const range = selection.getRangeAt(0)
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const pageEl = start?.closest<HTMLElement>('[data-page]')
    if (!pageEl) return
    const box = pageEl.getBoundingClientRect()
    const rects: PdfRect[] = []
    for (const rect of range.getClientRects()) {
      const centerY = rect.top + rect.height / 2
      if (rect.width < 2 || centerY < box.top || centerY > box.bottom) continue
      rects.push({
        x: round((rect.left - box.left) / box.width),
        y: round((rect.top - box.top) / box.height),
        w: round(rect.width / box.width),
        h: round(rect.height / box.height),
      })
    }
    if (rects.length === 0) return
    setPick({ text, page: Number(pageEl.dataset.page), rects })
  }, [])

  const clearPick = () => {
    window.getSelection()?.removeAllRanges()
    setPick(null)
  }
  const locationFor = (target: Pick): BrainNoteLocation => ({
    bookId: book.id,
    bookTitle: book.title,
    author: book.author,
    chapter: `Page ${target.page}`,
    page: target.page,
    cfi: `pdf:${target.page}:${target.rects.map((rect) => `${rect.x},${rect.y},${rect.w},${rect.h}`).join(';')}`,
  })

  // Tapping a highlight lets the reader change its colour or remove it.
  const tapPage = (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    if (window.getSelection()?.toString()) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    const hit = highlights.find(
      (item) =>
        item.page === pageNumber &&
        item.rects.some((rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h),
    )
    if (hit) setPick({ text: '', page: pageNumber, rects: hit.rects, noteId: hit.id, color: hit.color })
    else setPick(null)
  }

  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!doc || query.trim().length < 2) return
    setSearching(true)
    try {
      for (let index = texts.current.length; index < doc.numPages; index += 1) {
        const content = await (await doc.getPage(index + 1)).getTextContent()
        texts.current.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      }
      setResults(findInPages(texts.current, query))
    } finally {
      setSearching(false)
    }
  }

  const openOutline = async (value: string) => {
    const item = outline[Number(value)]
    if (!doc || !item) return
    try {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : (item.dest as unknown[] | null)
      const ref = dest?.[0]
      if (ref && typeof ref === 'object') goTo((await doc.getPageIndex(ref as never)) + 1)
      else if (typeof ref === 'number') goTo(ref + 1)
    } catch {
      // A broken link in the contents list is ignored.
    }
  }

  const total = doc?.numPages ?? 0
  const marksByPage = useMemo(() => {
    const map = new Map<number, PdfHighlight[]>()
    for (const item of highlights) map.set(item.page, [...(map.get(item.page) ?? []), item])
    return map
  }, [highlights])

  if (error) return <div className="pdf-error">{error}</div>

  return (
    <div className={`pdf-reader pdf-theme-${theme}`}>
      <div className="pdf-toolbar">
        <button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          <ChevronLeft size={16} />
        </button>
        <label className="pdf-page-input">
          <input
            type="number"
            min={1}
            max={total || 1}
            value={page}
            aria-label="Page number"
            onChange={(event) => {
              const next = Math.min(total, Math.max(1, Number(event.target.value) || 1))
              setPage(next)
              goTo(next)
            }}
          />
          <span>of {total || '…'}</span>
        </label>
        <button className="icon-button" aria-label="Next page" disabled={page >= total} onClick={() => goTo(page + 1)}>
          <ChevronRight size={16} />
        </button>
        <span className="pdf-toolbar-gap" />
        <button
          className="icon-button"
          aria-label="Smaller"
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))}
        >
          <Minus size={15} />
        </button>
        <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button"
          aria-label="Larger"
          onClick={() => setZoom((value) => Math.min(3, value + 0.15))}
        >
          <Plus size={15} />
        </button>
        {outline.length > 0 ? (
          <select aria-label="Contents" value="" onChange={(event) => void openOutline(event.target.value)}>
            <option value="">Contents</option>
            {outline.map((item, index) => (
              <option key={index} value={index}>
                {item.title}
              </option>
            ))}
          </select>
        ) : null}
        <form className="pdf-search" onSubmit={runSearch}>
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this PDF"
            aria-label="Search this PDF"
          />
        </form>
      </div>
      {results ? (
        <div className="pdf-results" role="listbox" aria-label="Search results">
          <div className="pdf-results-head">
            <strong>
              {results.length === 0 ? 'No matches' : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
            </strong>
            <button className="text-button" onClick={() => setResults(null)}>
              Close
            </button>
          </div>
          {results.slice(0, 60).map((result, index) => (
            <button
              key={index}
              className="pdf-result"
              onClick={() => {
                goTo(result.page)
                setResults(null)
              }}
            >
              <small>Page {result.page}</small> {result.snippet}
            </button>
          ))}
        </div>
      ) : null}
      {searching ? <div className="pdf-status">Searching…</div> : null}
      <div
        className="pdf-scroll"
        ref={scroller}
        onScroll={onScroll}
        onMouseUp={checkSelection}
        onTouchEnd={checkSelection}
      >
        {!doc || sizes.length === 0 ? <div className="pdf-status">Opening…</div> : null}
        {sizes.map((size, index) => {
          const scale = scaleFor(size)
          return (
            <div
              key={index}
              className="pdf-page"
              data-page={index + 1}
              ref={(element) => {
                pageEls.current[index] = element
              }}
              style={{ width: size.width * scale, height: size.height * scale }}
              onClick={(event) => tapPage(event, index + 1)}
            >
              {doc ? (
                <PdfPageView doc={doc} number={index + 1} scale={scale} root={scroller} night={theme === 'night'} />
              ) : null}
              {(marksByPage.get(index + 1) ?? []).flatMap((item) =>
                item.rects.map((rect, rectIndex) => (
                  <span
                    key={`${item.id}-${rectIndex}`}
                    className="pdf-mark"
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                      background: HIGHLIGHT_COLORS.find((color) => color.id === item.color)?.css,
                    }}
                  />
                )),
              )}
            </div>
          )
        })}
      </div>
      {pick ? (
        <div className="reader-pick" role="toolbar" aria-label="Highlight">
          {HIGHLIGHT_COLORS.map((item) => (
            <button
              key={item.id}
              className={'reader-pick-dot' + (pick.color === item.id ? ' reader-pick-dot-on' : '')}
              style={{ background: item.css }}
              aria-label={`${item.label} highlight`}
              onClick={() => {
                if (pick.noteId) props.onHighlightEdit(pick.noteId, item.id)
                else props.onHighlight(pick.text, item.id, locationFor(pick))
                clearPick()
              }}
            />
          ))}
          {pick.noteId ? (
            <button
              className="reader-pick-action"
              onClick={() => {
                props.onHighlightEdit(pick.noteId as string, null)
                clearPick()
              }}
            >
              Remove
            </button>
          ) : (
            <>
              <button
                className="reader-pick-action"
                onClick={() => {
                  props.onNote(pick.text, locationFor(pick))
                  clearPick()
                }}
              >
                Note
              </button>
              <button
                className="reader-pick-action"
                onClick={() => {
                  props.onAsk(pick.text, locationFor(pick))
                  clearPick()
                }}
              >
                Ask Noema
              </button>
            </>
          )}
          <button className="reader-pick-action" onClick={clearPick} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}
    </div>
  )
}

const round = (value: number) => Math.round(value * 10_000) / 10_000

// One page, drawn when it is near the screen and cleared when it is far away.
function PdfPageView({
  doc,
  number,
  scale,
  root,
  night,
}: {
  doc: PDFDocumentProxy
  number: number
  scale: number
  root: React.RefObject<HTMLDivElement | null>
  night: boolean
}) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const element = holder.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: '900px 0px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    const target = canvas.current
    const layer = textLayer.current
    if (!target || !layer) return
    if (!near) {
      target.width = 0
      layer.replaceChildren()
      return
    }
    let cancelled = false
    let task: { cancel: () => void } | null = null
    let text: { cancel: () => void } | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const pageProxy = await doc.getPage(number)
        if (cancelled) return
        const viewport = pageProxy.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        target.width = Math.floor(viewport.width * ratio)
        target.height = Math.floor(viewport.height * ratio)
        target.style.width = `${viewport.width}px`
        target.style.height = `${viewport.height}px`
        const context = target.getContext('2d')
        if (!context) return
        const render = pageProxy.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        })
        task = render
        await render.promise
        if (cancelled) return
        layer.replaceChildren()
        layer.style.setProperty('--scale-factor', String(scale))
        const textRender = new pdfjs.TextLayer({
          textContentSource: pageProxy.streamTextContent(),
          container: layer,
          viewport,
        })
        text = textRender
        await textRender.render()
      } catch {
        // A page that fails to draw stays blank; the rest of the document still reads.
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      text?.cancel()
    }
  }, [doc, number, scale, near])

  return (
    <div ref={holder} className="pdf-page-inner">
      <canvas ref={canvas} className={night ? 'pdf-canvas pdf-canvas-night' : 'pdf-canvas'} />
      <div ref={textLayer} className="textLayer" />
    </div>
  )
}
