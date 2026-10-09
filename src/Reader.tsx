import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  BookA,
  CloudRain,
  Brain,
  CircleHelp,
  FileText,
  Headphones,
  Highlighter,
  History,
  Lightbulb,
  Link2,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  PanelRight,
  Pause,
  SlidersHorizontal,
  Play,
  Plus,
  Search,
  Square,
  Sparkles,
  Type,
  X,
} from 'lucide-react'
import { BookCover } from './BookCover'
import { friendlyBookError } from './lib/text'
import {
  AMBIENT_OPTIONS,
  canPlayAmbient,
  readAmbient,
  startAmbient,
  writeAmbient,
  type AmbientKind,
  type AmbientPlayer,
} from './lib/ambient'
import { addReading, countWords, formatDuration, readPace, timeLeft, writePace, wordsPerMinute } from './lib/pace'
import { logReading, readDiary, writeDiary } from './lib/diary'
import { locateRange } from './lib/wordRange'
import { canListen, startListening, type ListenBlock, type ListenController } from './lib/listen'
import {
  HIGHLIGHT_COLORS,
  type BrainNote,
  type BrainNoteKind,
  type BrainNoteLocation,
  type HighlightColor,
} from './lib/knowledge'
import { firstReadingIndex, openEpub, spineSections } from './lib/epub'
import { loadEpubFile, type LibraryBook } from './lib/library'
import { useLatest } from './lib/useLatest'
import { PdfReader } from './PdfReader'
import { customFontCss } from './lib/customFont'
import { autoScrollPixelsPerSecond, pageScroll, tapZone } from './lib/readerControls'
import { parsePdfLocation } from './lib/pdfMarks'
import { FONT_STACKS, READER_COLORS, type ReaderTheme, type Settings } from './lib/settings'

type Note = BrainNote
type SearchHit = { cfi: string; excerpt: string; chapter: string }
const MAX_SEARCH_HITS = 40
export type NoteAction = 'highlight' | 'note' | 'question' | 'reflect' | 'connect'
export type ReaderNoteHandler = (text: string, kind?: NoteAction, location?: BrainNoteLocation) => void

type PageDirection = 'next' | 'previous'
type ReaderChapter = { label: string; href: string }
type ReaderLocation = {
  start?: {
    index?: number
    location?: number
    percentage?: number
    cfi?: string
    href?: string
    displayed?: { page?: number; total?: number }
  }
}
export type ReaderTutorContext = BrainNoteLocation & { visibleText?: string; selectedText?: string }
export type TutorHandler = (prompt: string, context?: ReaderTutorContext) => void

function normalizeReaderText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractVisibleReaderText(frame: HTMLDivElement | null): string {
  const iframe = frame?.querySelector('iframe')
  const document = iframe?.contentDocument
  const body = document?.body
  if (!document || !body) return ''
  const scrollingElement = document.scrollingElement ?? document.documentElement ?? body
  const viewportHeight = scrollingElement?.clientHeight || iframe?.clientHeight || 0
  const blocks = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, p, li, blockquote, pre'))
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.height > 0 && rect.bottom > -48 && rect.top < viewportHeight + 48
    })
    .map((element) => normalizeReaderText(element.textContent ?? ''))
    .filter((text) => text.length > 0)
  let excerpt = normalizeReaderText(blocks.join('\n\n'))
  const fullText = normalizeReaderText(body.innerText || body.textContent || '')
  if (excerpt.length < 120 && fullText) {
    const max = scrollingElement?.scrollHeight
      ? Math.max(1, scrollingElement.scrollHeight - scrollingElement.clientHeight)
      : 1
    const ratio = scrollingElement ? Math.max(0, Math.min(1, scrollingElement.scrollTop / max)) : 0
    const center = Math.round(ratio * fullText.length)
    excerpt = fullText.slice(Math.max(0, center - 1800), center + 10_200)
  }
  return excerpt.slice(0, 12_000)
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value as { items?: unknown; spineItems?: unknown }
  if (Array.isArray(record.items)) return record.items
  if (Array.isArray(record.spineItems)) return record.spineItems
  return []
}

function chapterEntries(value: unknown): ReaderChapter[] {
  return asArray(value).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as { label?: unknown; href?: unknown }
    const href = typeof record.href === 'string' ? record.href.trim() : ''
    if (!href) return []
    const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : 'Untitled chapter'
    return [{ label, href }]
  })
}

// Applies the reading settings to an epubjs rendition. Used when the book
// opens and whenever a setting changes.
function applyReadingStyle(
  themes: {
    fontSize: (value: string) => void
    override: (name: string, value: string, important?: boolean) => void
    default: (rules: Record<string, Record<string, string>>) => void
  },
  reading: Settings['reading'],
) {
  const colors = READER_COLORS[reading.theme]
  themes.fontSize(`${reading.fontSize}%`)
  themes.override('background-color', colors.background, true)
  themes.override('color', colors.color, true)
  themes.override('line-height', String(reading.lineHeight), true)
  themes.override('font-family', FONT_STACKS[reading.font] ?? 'inherit', true)
  if (reading.letterSpacing === 'wide') {
    themes.override('letter-spacing', '0.06em', true)
    themes.override('word-spacing', '0.16em', true)
  }
  // How a page of fiction looks: line length, paragraph style, justified text, drop caps.
  const width = { full: 'none', comfortable: '40em', narrow: '30em' }[reading.lineWidth]
  themes.override('max-width', width, true)
  themes.override('margin-left', 'auto', true)
  themes.override('margin-right', 'auto', true)
  const paragraph: Record<string, string> = {}
  if (reading.justify) {
    paragraph['text-align'] = 'justify !important'
    paragraph['hyphens'] = 'auto !important'
  }
  if (reading.paragraphs === 'indent') {
    paragraph['text-indent'] = '1.5em !important'
    paragraph['margin-top'] = '0 !important'
    paragraph['margin-bottom'] = '0 !important'
  } else if (reading.paragraphs === 'space') {
    paragraph['text-indent'] = '0 !important'
    paragraph['margin-top'] = '0 !important'
    paragraph['margin-bottom'] = '1em !important'
  }
  const rules: Record<string, Record<string, string>> = { p: paragraph }
  if (reading.paragraphs === 'indent') {
    rules['h1 + p, h2 + p, h3 + p, hr + p'] = { 'text-indent': '0 !important' }
  }
  if (reading.dropCap) {
    rules['h1 + p::first-letter, h2 + p::first-letter, h3 + p::first-letter'] = {
      float: 'left',
      'font-size': '3.1em',
      'line-height': '0.85',
      padding: '0.06em 0.08em 0 0',
      'font-weight': '700',
    }
  }
  themes.default(rules)
}

export function Reader({
  book,
  notes,
  onClose,
  onProgress,
  onNote,
  onOpenNote,
  onAsk,
  onRecap,
  onHighlight,
  onHighlightEdit,

  onSaveWord,
  initialSearch,
  onBookmark,
  reading,
  onReadingChange,
  initialLocation: jumpLocation,
}: {
  book: LibraryBook
  notes: Note[]
  onClose: () => void
  onProgress: (
    progress: number,
    cfi?: string,
    href?: string,
    chapter?: string,
    chapterIndex?: number,
    chapterProgress?: number,
  ) => void
  onNote: ReaderNoteHandler
  onOpenNote: (note: Note) => void
  onAsk: TutorHandler
  onRecap: () => void
  onHighlight: (text: string, color: HighlightColor, location: BrainNoteLocation) => void
  onHighlightEdit: (noteId: string, color: HighlightColor | null) => void

  onSaveWord: (word: string, definition: string, location: BrainNoteLocation) => void
  initialSearch?: string
  onBookmark: () => void
  reading: Settings['reading']
  onReadingChange: (patch: Partial<Settings['reading']>) => void
  initialLocation?: BrainNoteLocation | null
}) {
  const frame = useRef<HTMLDivElement>(null)
  const rendition =
    useRef<Awaited<ReturnType<typeof openEpub>>['renderTo'] extends (...args: never[]) => infer R ? R : never>(null)
  const epubRef = useRef<Awaited<ReturnType<typeof openEpub>> | null>(null)
  const external = book.format === 'web' || book.format === 'resource'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toc, setToc] = useState<ReaderChapter[]>(chapterEntries(book.toc))
  const [chapterIndex, setChapterIndex] = useState(Math.max(0, book.chapterIndex ?? 0))
  const [chapterProgress, setChapterProgress] = useState(Math.max(0, Math.min(1, book.chapterProgress ?? 0)))
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [pdfPage, setPdfPage] = useState(1)
  // Text size, page color, font and spacing come from Settings, so a change in
  // either place applies to every book.
  const { fontSize, theme: readerTheme } = reading
  const readingRef = useLatest(reading)
  const setFontSize = (value: number) => onReadingChange({ fontSize: value })
  const setReaderTheme = (value: ReaderTheme) => onReadingChange({ theme: value })
  // What the reader has just selected, or the highlight they tapped, with the colours to choose from.
  const [pick, setPick] = useState<{
    text: string
    location: BrainNoteLocation
    noteId?: string
    color?: HighlightColor
  } | null>(null)
  const [wideLayout, setWideLayout] = useState(reading.startWide)
  // The tools panel covers the page on a phone, so it starts closed there.
  const [toolsOpen, setToolsOpen] = useState(() => window.matchMedia('(min-width: 1600px)').matches)
  const [searchOpen, setSearchOpen] = useState(Boolean(initialSearch))
  const [searchTerm, setSearchTerm] = useState(initialSearch ?? '')
  const [searchOutcome, setSearchOutcome] = useState<{ query: string; hits: SearchHit[] }>({ query: '', hits: [] })
  const activeQuery = searchOpen && book.format === 'epub' ? searchTerm.trim() : ''
  const searchReady = activeQuery.length >= 2
  const searching = searchReady && searchOutcome.query !== activeQuery
  const searchResults = searchReady && !searching ? searchOutcome.hits : []
  const [pageTurn, setPageTurn] = useState<PageDirection | null>(null)
  const [pageNumber, setPageNumber] = useState<number | undefined>()
  const [wideCaptureKind, setWideCaptureKind] = useState<NoteAction>('highlight')
  const locationRef = useRef<{ page?: number; href?: string; cfi?: string }>({})
  const selectedTextRef = useRef('')
  const bookRef = useLatest(book)
  const readerCallbacksRef = useLatest({ onProgress, onNote })
  const wideLayoutRef = useLatest(wideLayout)
  const wideCaptureKindRef = useLatest(wideCaptureKind)
  const chaptersRef = useLatest(toc)
  const currentChapter = toc[chapterIndex] ?? { label: book.chapter || 'Opening', href: book.currentHref ?? '' }
  const chapterCount = toc.length
  const clampFraction = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const overallProgress = (index: number, fraction: number, count = chapterCount) =>
    count > 0
      ? Math.round(((Math.max(0, Math.min(index, count - 1)) + clampFraction(fraction)) / count) * 100)
      : Math.round(clampFraction(fraction) * 100)
  const visibleProgress = chapterCount > 0 ? overallProgress(chapterIndex, chapterProgress) : Math.round(book.progress)
  const currentNoteLocation = (): BrainNoteLocation => ({
    bookId: book.id,
    bookTitle: book.title,
    author: book.author,
    chapter: currentChapter.label,
    chapterIndex,
    page: book.format === 'pdf' ? pdfPage : locationRef.current.page,
    href: locationRef.current.href ?? currentChapter.href,
    cfi: book.format === 'pdf' ? `pdf:${pdfPage}` : locationRef.current.cfi,
  })
  const currentTutorContext = (): ReaderTutorContext => {
    const location = currentNoteLocation()
    const iframe = frame.current?.querySelector('iframe')
    const selectedText = iframe?.contentWindow?.getSelection()?.toString().trim() || selectedTextRef.current
    return {
      ...location,
      selectedText: selectedText || undefined,
      visibleText: extractVisibleReaderText(frame.current) || undefined,
    }
  }
  const goToChapter = (targetIndex: number) => {
    const chapters = chaptersRef.current
    const target = chapters[targetIndex]
    if (!target || !rendition.current || targetIndex < 0 || targetIndex >= chapters.length) return
    setChapterIndex(targetIndex)
    setChapterProgress(0)
    locationRef.current = { href: target.href }
    selectedTextRef.current = ''
    setPageNumber(undefined)
    setPageTurn(targetIndex > chapterIndex ? 'next' : 'previous')
    const progress = overallProgress(targetIndex, 0, chapters.length)
    readerCallbacksRef.current.onProgress(progress, undefined, target.href, target.label, targetIndex, 0)
    void rendition.current.display(target.href)
    window.setTimeout(() => setPageTurn(null), 360)
  }
  const goToChapterRef = useLatest(goToChapter)
  const noteChapterWordsRef = useRef<() => void>(() => undefined)
  // Read-aloud: reads from the top of the visible page to the end of the chapter, then carries on.
  const [controlsOpen, setControlsOpen] = useState(false)
  const [autoScroll, setAutoScroll] = useState(false)
  const [chapterEnd, setChapterEnd] = useState<number | null>(null)
  const dismissedEnds = useRef(new Set<string>())
  const bodyRef = useRef<HTMLDivElement>(null)
  // On a phone the app's own header and tab bar step aside while a book is open.
  useEffect(() => {
    document.body.classList.add('reading-focus')
    return () => document.body.classList.remove('reading-focus')
  }, [])
  const speedRef = useLatest(reading.autoScrollSpeed)
  const [listening, setListening] = useState<'off' | 'on' | 'paused'>('off')
  const listenRef = useRef<ListenController | null>(null)
  const chapterIndexRef = useLatest(chapterIndex)
  const rateRef = useLatest(reading.speechRate)
  const collectBlocks = (fromView: boolean): ListenBlock[] => {
    const iframe = frame.current?.querySelector('iframe')
    const doc = iframe?.contentDocument
    if (!doc?.body) return []
    const all = Array.from(doc.body.querySelectorAll('h1, h2, h3, h4, h5, p, li, blockquote'))
      .map((element) => ({ element, text: normalizeReaderText(element.textContent ?? '') }))
      .filter((block) => block.text.length > 1)
    if (!fromView) return all
    const start = all.findIndex((block) => block.element.getBoundingClientRect().bottom > 4)
    return start >= 0 ? all.slice(start) : all
  }
  // The sentence being read is shaded and the word being spoken is marked, where the browser can do so.
  const markSpoken = (element: Element | undefined, start: number, end: number) => {
    const doc = element?.ownerDocument
    const view = doc?.defaultView as
      | (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => unknown })
      | null
      | undefined
    if (!element || !doc || !view?.CSS?.highlights || !view.Highlight) return
    if (!doc.getElementById('noesis-speaking-style')) {
      const style = doc.createElement('style')
      style.id = 'noesis-speaking-style'
      style.textContent =
        '::highlight(noesis-block){background-color:rgba(255,214,120,.16)}::highlight(noesis-word){background-color:rgba(255,196,64,.55)}'
      doc.head.appendChild(style)
    }
    const block = doc.createRange()
    block.selectNodeContents(element)
    view.CSS.highlights.set('noesis-block', new view.Highlight(block))
    if (end <= start) {
      view.CSS.highlights.delete('noesis-word')
      return
    }
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    const place = locateRange(
      nodes.map((node) => node.data),
      start,
      end,
    )
    if (!place) return
    const word = doc.createRange()
    word.setStart(nodes[place.start.part], place.start.offset)
    word.setEnd(nodes[place.end.part], place.end.offset)
    view.CSS.highlights.set('noesis-word', new view.Highlight(word))
  }
  const clearSpoken = () => {
    const doc = frame.current?.querySelector('iframe')?.contentDocument
    const view = doc?.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> } }) | null | undefined
    view?.CSS?.highlights?.clear()
  }
  const stopListening = () => {
    clearSpoken()
    listenRef.current?.stop()
    listenRef.current = null
    setListening('off')
  }
  const listen = (fromView: boolean) => {
    const blocks = collectBlocks(fromView)
    if (blocks.length === 0) {
      setListening('off')
      return
    }
    listenRef.current?.stop()
    listenRef.current = startListening(blocks, {
      rate: rateRef.current,
      onBlock: (block) => {
        block.element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        markSpoken(block.element, 0, 0)
      },
      onWord: (block, start, end) => markSpoken(block.element, start, end),
      onDone: () => {
        const next = chapterIndexRef.current + 1
        if (next < chaptersRef.current.length) {
          goToChapterRef.current(next)
          window.setTimeout(() => listen(false), 1600)
        } else {
          setListening('off')
        }
      },
    })
    setListening('on')
  }
  const toggleListening = () => {
    if (listening === 'off') listen(true)
    else if (listening === 'on') {
      listenRef.current?.pause()
      setListening('paused')
    } else {
      listenRef.current?.resume()
      setListening('on')
    }
  }
  useEffect(
    () => () => {
      listenRef.current?.stop()
    },
    [],
  )
  // At the bottom of a long chapter a quiet card offers a pause. It appears once per chapter and never blocks reading.
  useEffect(() => {
    if (book.format !== 'epub' || loading || !reading.chapterEnd) return
    const container = bodyRef.current?.querySelector<HTMLElement>('.epub-container')
    if (!container) return
    const check = () => {
      const atEnd = container.scrollTop + container.clientHeight >= container.scrollHeight - 12
      const long = container.scrollHeight > container.clientHeight * 2.2
      const index = chapterIndexRef.current
      if (atEnd && long && !dismissedEnds.current.has(`${book.id}:${index}`)) setChapterEnd(index)
      else if (!atEnd) setChapterEnd(null)
    }
    container.addEventListener('scroll', check, { passive: true })
    return () => container.removeEventListener('scroll', check)
  }, [book.format, book.id, loading, reading.chapterEnd, chapterIndexRef])
  const closeChapterEnd = () => {
    if (chapterEnd !== null) dismissedEnds.current.add(`${book.id}:${chapterEnd}`)
    setChapterEnd(null)
  }
  // Slowly scrolls the page; touching it or pressing a key hands control back.
  useEffect(() => {
    if (!autoScroll) return
    const container = bodyRef.current?.querySelector<HTMLElement>('.epub-container, .pdf-scroll')
    if (!container) return
    let frameId = 0
    let last = performance.now()
    let position = container.scrollTop
    const step = (now: number) => {
      position += (autoScrollPixelsPerSecond(speedRef.current) * (now - last)) / 1000
      last = now
      container.scrollTop = position
      if (position >= container.scrollHeight - container.clientHeight - 1) {
        // The end of the chapter: carry on into the next one.
        const next = chapterIndexRef.current + 1
        setAutoScroll(false)
        if (book.format === 'epub' && next < chaptersRef.current.length) {
          goToChapterRef.current(next)
          window.setTimeout(() => setAutoScroll(true), 1500)
        }
        return
      }
      frameId = window.requestAnimationFrame(step)
    }
    frameId = window.requestAnimationFrame(step)
    const stop = () => setAutoScroll(false)
    container.addEventListener('wheel', stop, { passive: true })
    container.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('keydown', stop)
    return () => {
      window.cancelAnimationFrame(frameId)
      container.removeEventListener('wheel', stop)
      container.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [autoScroll, book.format, speedRef, chapterIndexRef, chaptersRef, goToChapterRef])
  useEffect(() => {
    noteChapterWordsRef.current = noteChapterWords
  })
  // Time left, from the length of this chapter and how fast this reader reads.
  const [chapterWords, setChapterWords] = useState(0)
  const chapterWordsRef = useRef<Map<number, number>>(new Map())
  const wpm = wordsPerMinute(readPace())
  const averageWords = (() => {
    const counts = [...chapterWordsRef.current.values()]
    return counts.length ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0
  })()
  const left =
    book.format === 'epub' && chapterWords > 0 && chapterCount > 0
      ? timeLeft({
          chapterWords,
          chapterProgress,
          chapterIndex,
          chapterCount,
          averageChapterWords: averageWords || chapterWords,
          wpm,
        })
      : null
  const noteChapterWords = () => {
    const doc = frame.current?.querySelector('iframe')?.contentDocument
    const words = countWords(doc?.body?.innerText || doc?.body?.textContent || '')
    if (words > 0) {
      chapterWordsRef.current.set(chapterIndexRef.current, words)
      setChapterWords(words)
    }
  }
  // Pace and the reading diary: each step of reading adds its time and distance.
  const lastStep = useRef<{ at: number; index: number; fraction: number } | null>(null)
  useEffect(() => {
    if (book.format !== 'epub' || chapterWords === 0) return
    const now = Date.now()
    const last = lastStep.current
    lastStep.current = { at: now, index: chapterIndex, fraction: chapterProgress }
    if (!last || last.index !== chapterIndex) return
    const minutes = (now - last.at) / 60_000
    const advance = chapterProgress - last.fraction
    if (advance <= 0 || minutes < 0.03 || minutes > 2) return
    writePace(addReading(readPace(), advance * chapterWords, minutes))
    const to = bookRef.current.progress
    writeDiary(logReading(readDiary(), { bookId: book.id, title: book.title, minutes, from: to - advance * 5, to }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterProgress, chapterIndex])

  // Background sound.
  const [ambient, setAmbient] = useState(readAmbient)
  const [ambientOpen, setAmbientOpen] = useState(false)
  const ambientRef = useRef<AmbientPlayer | null>(null)
  const chooseAmbient = (kind: AmbientKind | null) => {
    ambientRef.current?.stop()
    ambientRef.current = kind ? startAmbient(kind, ambient.volume) : null
    const next = { kind, volume: ambient.volume }
    setAmbient(next)
    writeAmbient(next)
  }
  useEffect(
    () => () => {
      ambientRef.current?.stop()
    },
    [],
  )

  // Highlights on a PDF are placed from the page fractions saved with them.
  const pdfHighlights = useMemo(
    () =>
      notes.flatMap((note) => {
        const place = parsePdfLocation(note.cfi)
        return note.bookId === book.id && note.kind === 'highlight' && place && place.rects.length
          ? [{ id: note.id, color: note.color ?? ('yellow' as HighlightColor), page: place.page, rects: place.rects }]
          : []
      }),
    [notes, book.id],
  )
  const pdfStart = parsePdfLocation(jumpLocation?.cfi)?.page ?? parsePdfLocation(book.cfi)?.page ?? 1

  // Highlights are drawn on the page in the colour they were saved with.
  const drawn = useRef(new Map<string, { cfi: string; color: HighlightColor }>())
  const highlightKey = notes
    .filter((note) => note.bookId === book.id && note.kind === 'highlight' && note.cfi?.startsWith('epubcfi'))
    .map((note) => `${note.id}|${note.cfi}|${note.color ?? 'yellow'}`)
    .join(';')
  useEffect(() => {
    const instance = rendition.current
    if (loading || !instance || book.format !== 'epub') {
      drawn.current.clear()
      return
    }
    const wanted = new Map<string, { cfi: string; color: HighlightColor }>()
    for (const entry of highlightKey ? highlightKey.split(';') : []) {
      const [id, cfi, color] = entry.split('|')
      wanted.set(id, { cfi, color: color as HighlightColor })
    }
    for (const [id, info] of drawn.current) {
      const next = wanted.get(id)
      if (next && next.cfi === info.cfi && next.color === info.color) continue
      try {
        instance.annotations.remove(info.cfi, 'highlight')
      } catch {
        // Already gone from the page.
      }
      drawn.current.delete(id)
    }
    for (const [id, info] of wanted) {
      if (drawn.current.has(id)) continue
      const css = HIGHLIGHT_COLORS.find((item) => item.id === info.color)?.css ?? '#f2d46b'
      try {
        instance.annotations.highlight(
          info.cfi,
          { noteId: id },
          () => setPick({ text: '', location: currentNoteLocation(), noteId: id, color: info.color }),
          'noesis-highlight',
          { fill: css, 'fill-opacity': '0.38', 'mix-blend-mode': 'multiply' },
        )
        drawn.current.set(id, info)
      } catch {
        // A mark that can't be placed just isn't drawn.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey, loading, book.format])
  const finishPick = () => {
    frame.current?.querySelector('iframe')?.contentWindow?.getSelection()?.removeAllRanges()
    selectedTextRef.current = ''
    setPick(null)
  }
  const chooseColor = (color: HighlightColor) => {
    if (!pick) return
    if (pick.noteId) onHighlightEdit(pick.noteId, color)
    else onHighlight(pick.text, color, pick.location)
    finishPick()
  }

  // The meaning of the selected word.
  const [define, setDefine] = useState<{
    word: string
    state: 'looking' | 'found' | 'missing' | 'error'
    phonetic?: string
    meanings?: Array<{ partOfSpeech: string; definition: string }>
  } | null>(null)
  const defineSelection = async () => {
    const iframe = frame.current?.querySelector('iframe')
    const selected = (iframe?.contentWindow?.getSelection()?.toString().trim() || selectedTextRef.current).trim()
    const word = selected.split(/\s+/)[0]?.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '') ?? ''
    if (!word || selected.split(/\s+/).length > 1) {
      setDefine({ word: '', state: 'error' })
      return
    }
    setDefine({ word, state: 'looking' })
    try {
      const response = await fetch(`/api/define?word=${encodeURIComponent(word)}`)
      const result = (await response.json()) as {
        ok?: boolean
        found?: boolean
        phonetic?: string
        meanings?: Array<{ partOfSpeech: string; definition: string }>
      }
      if (!response.ok || !result.ok) throw new Error('lookup failed')
      setDefine(
        result.found
          ? { word, state: 'found', phonetic: result.phonetic, meanings: result.meanings }
          : { word, state: 'missing' },
      )
    } catch {
      setDefine({ word, state: 'error' })
    }
  }
  useEffect(() => {
    if (!wideLayout) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // The expanded page covers the whole window, including the sidebar.
    document.body.classList.add('reader-wide-open')
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.classList.remove('reader-wide-open')
    }
  }, [wideLayout])
  useEffect(() => {
    if (book.format !== 'epub') return
    const element = frame.current
    const current = rendition.current
    if (!element || !current) return
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width < 1 || bounds.height < 1) return
      current.resize(Math.floor(bounds.width), Math.floor(bounds.height))
    }
    const firstFrame = window.requestAnimationFrame(resize)
    const secondFrame = window.requestAnimationFrame(() => window.requestAnimationFrame(resize))
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(element)
    window.addEventListener('resize', resize)
    resize()
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [book.format, wideLayout, loading])
  useEffect(() => {
    let cancelled = false
    let cleanupReading = () => undefined
    const currentBook = bookRef.current
    const { onProgress: reportProgress } = readerCallbacksRef.current
    const isExternal = currentBook.format === 'web' || currentBook.format === 'resource'
    const start = async () => {
      setLoading(true)
      setError('')
      try {
        if (isExternal) {
          setLoading(false)
          return
        }
        const data = await loadEpubFile(currentBook.id)
        if (!data) throw new Error('This EPUB is no longer stored on this device. Import it again to continue reading.')
        if (currentBook.format === 'pdf') {
          if (!cancelled) {
            setPdfData(data)
            setLoading(false)
          }
          return
        }
        const epub = await openEpub(data)
        if (cancelled || !frame.current) {
          epub.destroy()
          return
        }
        epubRef.current = epub
        const navigation = await epub.loaded.navigation
        const navigationChapters = chapterEntries(navigation.toc)
        const spineItems = await epub.loaded.spine
        const spineChapters = asArray(spineItems).flatMap((entry, index) => {
          if (!entry || typeof entry !== 'object') return []
          const record = entry as { href?: unknown; url?: unknown }
          const href =
            typeof record.href === 'string'
              ? record.href.trim()
              : typeof record.url === 'string'
                ? record.url.trim()
                : ''
          return href ? [{ label: `Chapter ${index + 1}`, href }] : []
        })
        const savedChapters = chapterEntries(currentBook.toc)
        const chapters =
          savedChapters.length > 0 ? savedChapters : navigationChapters.length > 0 ? navigationChapters : spineChapters
        // Page numbers come from scanning the whole book, which is slow, so the book opens first.
        // The result is kept for next time.
        let generatedLocationCount = 0
        const locationsKey = `noesis:locations:v1:${currentBook.id}`
        try {
          const saved = localStorage.getItem(locationsKey)
          if (saved) {
            epub.locations.load(saved)
            generatedLocationCount = epub.locations.length()
          }
        } catch {
          // A bad saved copy is simply rebuilt.
        }
        if (generatedLocationCount === 0) {
          void epub.locations
            .generate(1200)
            .then(() => {
              if (cancelled) return
              generatedLocationCount = epub.locations.length()
              try {
                localStorage.setItem(locationsKey, epub.locations.save())
              } catch {
                // Storage can be full; the numbers are rebuilt next time.
              }
            })
            .catch(() => {
              // Some EPUBs do not expose enough text for generated locations. The
              // rendition's displayed page metadata remains the source of truth.
            })
        }
        const targetLocation = jumpLocation?.bookId === currentBook.id ? jumpLocation : null
        const savedHref = targetLocation?.href ?? currentBook.currentHref
        const initialIndexByHref = savedHref
          ? chapters.findIndex((item) => savedHref.includes(item.href.split('#')[0]))
          : -1
        const initialIndex = Math.max(
          0,
          Math.min(
            chapters.length - 1,
            targetLocation?.chapterIndex ??
              currentBook.chapterIndex ??
              (initialIndexByHref >= 0
                ? initialIndexByHref
                : currentBook.progress > 0
                  ? 0
                  : firstReadingIndex(chapters, currentBook.title)),
          ),
        )
        const initialChapterProgress = clampFraction(
          currentBook.chapterProgress ??
            (chapters.length > 0
              ? (currentBook.progress / 100) * chapters.length - initialIndex
              : currentBook.progress / 100),
        )
        locationRef.current = {
          page: targetLocation?.page,
          href: targetLocation?.href ?? currentBook.currentHref,
          cfi: targetLocation?.cfi ?? currentBook.cfi,
        }
        setPageNumber(targetLocation?.page)
        setToc(chapters)
        setChapterIndex(initialIndex)
        setChapterProgress(initialChapterProgress)
        const instance = epub.renderTo(frame.current, {
          width: '100%',
          height: '100%',
          flow: 'scrolled-doc',
          spread: 'none',
        })
        rendition.current = instance
        // A font the reader brought along is made available inside each page.
        const fontCss = await customFontCss()
        if (fontCss) {
          instance.hooks.content.register((contents: { document: Document }) => {
            const style = contents.document.createElement('style')
            style.textContent = fontCss
            contents.document.head.appendChild(style)
          })
        }
        applyReadingStyle(instance.themes, readingRef.current)
        let activeChapterIndex = initialIndex
        let scrollTimer: number | undefined
        const scrollTargets = new Set<EventTarget>()
        const scrollFraction = (target: EventTarget | null): number | undefined => {
          const element =
            target instanceof Document
              ? (target.scrollingElement ?? target.documentElement)
              : target instanceof HTMLElement
                ? target
                : null
          if (!element) return undefined
          const max = element.scrollHeight - element.clientHeight
          return max > 0 ? clampFraction(element.scrollTop / max) : undefined
        }
        const activeFraction = () => {
          const iframe = frame.current?.querySelector('iframe')
          const contentDocument = iframe?.contentDocument
          const targets: EventTarget[] = [
            contentDocument?.scrollingElement,
            contentDocument?.documentElement,
            contentDocument?.body,
            frame.current?.querySelector('.epub-container'),
          ].filter(Boolean) as EventTarget[]
          const values = targets
            .map((target) => scrollFraction(target))
            .filter((value): value is number => value !== undefined)
          return values.length > 0 ? values.sort((a, b) => b - a)[0] : undefined
        }
        const chapterFromLocation = (location: ReaderLocation) => {
          const href = location.start?.href
          const found = chapters.findIndex((item) => href?.includes(item.href.split('#')[0]))
          if (found >= 0) return found
          const index = location.start?.index
          return typeof index === 'number' ? Math.max(0, Math.min(chapters.length - 1, index)) : activeChapterIndex
        }
        const reportLocation = (location: ReaderLocation | undefined, fractionOverride?: number) => {
          if (!location?.start) return
          const nextIndex = chapterFromLocation(location)
          activeChapterIndex = nextIndex
          const displayed = location.start.displayed
          const displayedFraction =
            displayed?.total && displayed.total > 0 ? ((displayed.page ?? 1) - 1) / displayed.total : undefined
          const fraction = clampFraction(
            fractionOverride ?? activeFraction() ?? displayedFraction ?? location.start.percentage ?? 0,
          )
          const label = chapters[nextIndex]?.label ?? currentBook.chapter
          const progress = overallProgress(nextIndex, fraction, chapters.length)
          const generatedLocation =
            location.start.cfi && generatedLocationCount > 0
              ? (epub.locations.locationFromCfi(location.start.cfi) as unknown as number)
              : -1
          const generatedPage =
            Number.isFinite(generatedLocation) && generatedLocation >= 0 ? generatedLocation + 1 : undefined
          const page = displayed?.page ?? generatedPage
          locationRef.current = {
            page,
            href: location.start.href ?? chapters[nextIndex]?.href,
            cfi: location.start.cfi,
          }
          setPageNumber(page)
          setChapterIndex(nextIndex)
          setChapterProgress(fraction)
          reportProgress(
            progress,
            location.start.cfi,
            location.start.href ?? chapters[nextIndex]?.href,
            label,
            nextIndex,
            fraction,
          )
        }
        const handleScroll = (event: Event) => {
          selectedTextRef.current = ''
          if (scrollTimer) return
          scrollTimer = window.setTimeout(() => {
            scrollTimer = undefined
            const location = instance.currentLocation() as ReaderLocation | Promise<ReaderLocation> | undefined
            void Promise.resolve(location).then((value) => reportLocation(value, scrollFraction(event.target)))
          }, 120)
        }
        const attachScroll = (target: EventTarget | null) => {
          if (!target || scrollTargets.has(target)) return
          scrollTargets.add(target)
          target.addEventListener('scroll', handleScroll, { passive: true } as AddEventListenerOptions)
        }
        const attachView = (_section: unknown, view: { contents?: { document?: Document } }) => {
          const contentDocument = view?.contents?.document
          if (!contentDocument) return
          attachScroll(contentDocument)
          // Touching the page, or pressing a key, hands control back from auto-scroll.
          for (const name of ['wheel', 'touchstart', 'keydown'] as const)
            contentDocument.addEventListener(name, () => setAutoScroll(false), { passive: true })
          // Tapping near the top or bottom of the page turns it.
          contentDocument.addEventListener('click', (event) => {
            if (!readingRef.current.tapZones || contentDocument.getSelection()?.toString()) return
            if ((event.target as Element | null)?.closest?.('a, svg, button, input')) return
            const container = bodyRef.current?.querySelector<HTMLElement>('.epub-container')
            if (!container) return
            const zone = tapZone(event.clientY - container.scrollTop, container.clientHeight)
            if (!zone) return
            const atEdge =
              zone === 'down'
                ? container.scrollTop + container.clientHeight >= container.scrollHeight - 4
                : container.scrollTop <= 4
            const target = chapterIndexRef.current + (zone === 'down' ? 1 : -1)
            if (atEdge && target >= 0 && target < chaptersRef.current.length) goToChapterRef.current(target)
            else
              container.scrollBy({
                top: (zone === 'down' ? 1 : -1) * pageScroll(container.clientHeight),
                behavior: 'smooth',
              })
          })
          // The choices go away when the selection is let go of.
          let clearTimer: number | undefined
          contentDocument.addEventListener('selectionchange', () => {
            window.clearTimeout(clearTimer)
            clearTimer = window.setTimeout(() => {
              if (contentDocument.getSelection()?.isCollapsed) setPick((current) => (current?.noteId ? current : null))
            }, 250)
          })
          window.setTimeout(() => noteChapterWordsRef.current(), 300)
          attachScroll(contentDocument.scrollingElement)
          attachScroll(contentDocument.documentElement)
          attachScroll(contentDocument.body)
        }
        instance.on('relocated', (location: ReaderLocation) => reportLocation(location))
        instance.on('rendered', attachView)
        instance.on('selected', (cfiRange: string, contents: { window?: Window }) => {
          const text = contents.window?.getSelection()?.toString().trim() ?? ''
          if (!text) return
          selectedTextRef.current = text
          const selectionLocation =
            cfiRange && generatedLocationCount > 0
              ? (epub.locations.locationFromCfi(cfiRange) as unknown as number)
              : -1
          const selectionPage =
            locationRef.current.page ??
            (Number.isFinite(selectionLocation) && selectionLocation >= 0 ? selectionLocation + 1 : undefined)
          setPick({
            text,
            location: {
              bookId: currentBook.id,
              bookTitle: currentBook.title,
              author: currentBook.author,
              chapter: chapters[activeChapterIndex]?.label ?? currentBook.chapter,
              chapterIndex: activeChapterIndex,
              page: selectionPage,
              href: locationRef.current.href ?? chapters[activeChapterIndex]?.href,
              cfi: cfiRange,
            },
          })
        })
        const firstChapter = chapters[initialIndex]?.href
        const savedLocation = targetLocation?.cfi || targetLocation?.href || currentBook.cfi || currentBook.currentHref
        // Open straight at the saved place. If that shows nothing (an old address, or a contents
        // entry that doesn't match the book), fall back to the chapter, then to the first pages.
        const shownContent = () => {
          const doc = frame.current?.querySelector('iframe')?.contentDocument
          return Boolean(doc?.body && (doc.body.textContent ?? '').trim().length > 0)
        }
        const candidates = [
          savedLocation,
          firstChapter,
          ...spineChapters.slice(0, 4).map((entry) => entry.href),
        ].filter((target, index, all): target is string => Boolean(target) && all.indexOf(target) === index)
        let opened = false
        let displayedOnce = false
        for (const target of candidates) {
          try {
            await instance.display(target)
            if (cancelled) return
            displayedOnce = true
            if (shownContent()) {
              opened = true
              break
            }
          } catch {
            // Try the next way in.
          }
        }
        // A chapter that is only pictures still counts as open.
        if (!opened && !displayedOnce) throw new Error('This EPUB has no readable opening chapter.')
        const iframe = frame.current?.querySelector('iframe')
        if (iframe?.contentDocument) attachView(undefined, { contents: { document: iframe.contentDocument } })
        const initialLocation = instance.currentLocation() as ReaderLocation | Promise<ReaderLocation> | undefined
        void Promise.resolve(initialLocation).then((location) => reportLocation(location, initialChapterProgress))
        cleanupReading = () => {
          if (scrollTimer) window.clearTimeout(scrollTimer)
          scrollTargets.forEach((target) => target.removeEventListener('scroll', handleScroll))
          scrollTargets.clear()
        }
      } catch (reason) {
        if (!cancelled) setError(friendlyBookError(reason, 'Could not open this EPUB.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      cleanupReading()
      rendition.current?.destroy()
      epubRef.current?.destroy()
      rendition.current = null
      epubRef.current = null
    }
  }, [
    book.id,
    bookRef,
    readerCallbacksRef,
    wideLayoutRef,
    wideCaptureKindRef,
    jumpLocation,
    readingRef,
    chapterIndexRef,
    chaptersRef,
    goToChapterRef,
  ])
  useEffect(() => {
    const query = activeQuery
    if (query.length < 2) return
    let active = true
    const timer = window.setTimeout(async () => {
      const epub = epubRef.current
      if (!epub) {
        if (active) setSearchOutcome({ query, hits: [] })
        return
      }
      const hits: SearchHit[] = []
      try {
        await epub.loaded.spine
        for (const item of spineSections(epub)) {
          if (!active || hits.length >= MAX_SEARCH_HITS) break
          try {
            const section = epub.spine.get(item.index)
            await section.load(epub.load.bind(epub))
            const found = section.find(query) as unknown as Array<{ cfi?: string; excerpt?: string }>
            section.unload()
            const chapterIndex = chaptersRef.current.findIndex((chapter) =>
              item.href?.includes(chapter.href.split('#')[0]),
            )
            for (const match of found) {
              if (match.cfi && match.excerpt) {
                hits.push({
                  cfi: match.cfi,
                  excerpt: match.excerpt.trim(),
                  chapter: chaptersRef.current[chapterIndex]?.label ?? `Section ${item.index + 1}`,
                })
              }
              if (hits.length >= MAX_SEARCH_HITS) break
            }
          } catch {
            // A section that cannot be searched should not stop the rest.
          }
        }
      } catch {
        // Search is an enhancement; the reader keeps working without it.
      }
      if (active) setSearchOutcome({ query, hits })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [activeQuery, chaptersRef])
  useEffect(() => {
    const current = rendition.current
    if (!current || book.format !== 'epub') return
    applyReadingStyle(current.themes, reading)
  }, [book.format, reading])
  const handleChapterSelect = (href: string) => {
    const index = toc.findIndex((item) => item.href === href)
    if (index >= 0) goToChapterRef.current(index)
  }
  const chapterLabel = chapterCount > 0 ? `${chapterIndex + 1} of ${chapterCount}` : 'Opening'
  const bookNotes = notes
    .filter((note) => note.bookId === book.id || note.source.toLowerCase().includes(book.title.toLowerCase()))
    .slice(0, 5)
  const noteIcon = (kind: BrainNoteKind) =>
    kind === 'highlight' ? (
      <Highlighter size={13} />
    ) : kind === 'question' ? (
      <MessageCircleQuestion size={13} />
    ) : kind === 'idea' ? (
      <Lightbulb size={13} />
    ) : kind === 'connection' ? (
      <Link2 size={13} />
    ) : (
      <FileText size={13} />
    )
  const noteLocationLabel = (note: Note) =>
    [note.chapter, note.page ? `p. ${note.page}` : ''].filter(Boolean).join(' · ')
  return (
    <section
      className={
        'reader-page panel-card ' +
        (wideLayout ? 'reader-page-wide' : '') +
        (pageTurn ? ' reader-page-turn-' + pageTurn : '')
      }
    >
      {wideLayout ? (
        <div className="reader-wide-topbar" aria-label="Expanded reader controls">
          <div className="reader-wide-capture">
            <span>Capture</span>
            <select
              value={wideCaptureKind}
              onChange={(event) => setWideCaptureKind(event.target.value as NoteAction)}
              aria-label="Choose what to capture"
            >
              <option value="highlight">Highlight</option>
              <option value="note">Note</option>
              <option value="question">Question</option>
              <option value="reflect">Reflect</option>
              <option value="connect">Connect</option>
            </select>
            <small>{pageNumber ? `p. ${pageNumber}` : chapterLabel}</small>
            <button
              className="reader-wide-capture-button"
              onClick={() => onNote('', wideCaptureKind, currentNoteLocation())}
              aria-label={`Open Second Brain for ${wideCaptureKind}`}
              title={`Capture ${wideCaptureKind} at ${pageNumber ? `page ${pageNumber}` : 'this location'}`}
            >
              <Brain size={16} />
            </button>
          </div>
          <div className="reader-wide-actions">
            <button
              className={'icon-button' + (toolsOpen ? ' reader-listening' : '')}
              onClick={() => setToolsOpen((value) => !value)}
              aria-label={toolsOpen ? 'Hide reading tools' : 'Show reading tools'}
              aria-pressed={toolsOpen}
              title="Reading tools"
            >
              <PanelRight size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => onAsk('Explain the current page or selected passage', currentTutorContext())}
              aria-label="Ask Noema about this page"
              title="Ask Noema about this page"
            >
              <Sparkles size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => setWideLayout(false)}
              aria-label="Exit expanded view"
              title="Exit expanded view"
            >
              <Minimize2 size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="reader-toolbar">
          <button className="secondary-button" onClick={onClose}>
            <ArrowLeft size={15} /> Library
          </button>
          <div className="reader-title">
            <strong>{book.title}</strong>
            <span>
              {book.format === 'pdf'
                ? 'PDF document'
                : external
                  ? (book.accessType === 'borrow' ? 'Borrowed' : 'Hosted') + ' reading source'
                  : currentChapter.label}
              {left
                ? ` · ${formatDuration(left.chapter)} left in chapter${chapterWordsRef.current.size >= 3 ? ` · about ${formatDuration(left.book)} to finish` : ''}`
                : ''}
            </span>
          </div>
          <div className="reader-controls">
            {book.format === 'epub' ? (
              <select
                className="reader-contents-select"
                value={currentChapter.href}
                onChange={(event) => handleChapterSelect(event.target.value)}
                aria-label="Contents"
              >
                {toc.length === 0 ? (
                  <option value="">Contents</option>
                ) : (
                  toc.map((item) => (
                    <option key={item.href + '-' + item.label} value={item.href}>
                      {item.label}
                    </option>
                  ))
                )}
              </select>
            ) : null}
            <button
              className={'icon-button' + (book.bookmarked ? ' reader-bookmarked' : '')}
              onClick={onBookmark}
              aria-label={book.bookmarked ? 'Remove bookmark' : 'Bookmark this location'}
              aria-pressed={Boolean(book.bookmarked)}
            >
              <Bookmark size={16} fill={book.bookmarked ? 'currentColor' : 'none'} />
            </button>
            {book.format === 'epub' ? (
              <button
                className="icon-button"
                onClick={() => void defineSelection()}
                aria-label="Define the selected word"
                title="Select a word, then define it"
              >
                <BookA size={16} />
              </button>
            ) : null}
            <button
              className={'icon-button' + (toolsOpen ? ' reader-listening' : '')}
              onClick={() => setToolsOpen((value) => !value)}
              aria-label={toolsOpen ? 'Hide reading tools' : 'Show reading tools'}
              aria-pressed={toolsOpen}
              title="Notes and Noema beside the page"
            >
              <PanelRight size={16} />
            </button>
            {book.format === 'epub' || book.format === 'pdf' ? (
              <span className="reader-ambient">
                <button
                  className={
                    'icon-button' + (autoScroll || reading.tapZones || reading.dim > 0 ? ' reader-listening' : '')
                  }
                  onClick={() => setControlsOpen((value) => !value)}
                  aria-label="Page controls"
                  aria-expanded={controlsOpen}
                  title="Auto-scroll, dimming and tap zones"
                >
                  <SlidersHorizontal size={16} />
                </button>
                {controlsOpen ? (
                  <div className="reader-ambient-pop reader-controls-pop">
                    <button
                      className={autoScroll ? 'reader-ambient-on' : ''}
                      onClick={() => setAutoScroll((value) => !value)}
                    >
                      {autoScroll ? 'Stop auto-scroll' : 'Start auto-scroll'}
                    </button>
                    <label>
                      Speed
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={reading.autoScrollSpeed}
                        aria-label="Auto-scroll speed"
                        onChange={(event) => onReadingChange({ autoScrollSpeed: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Dim the page
                      <input
                        type="range"
                        min="0"
                        max="60"
                        step="5"
                        value={reading.dim}
                        aria-label="Dim the page"
                        onChange={(event) => onReadingChange({ dim: Number(event.target.value) })}
                      />
                    </label>
                    {book.format === 'epub' ? (
                      <div className="reader-controls-narrow">
                        <label>
                          Text size
                          <input
                            type="range"
                            min="85"
                            max="125"
                            step="5"
                            value={fontSize}
                            onChange={(event) => setFontSize(Number(event.target.value))}
                            aria-label="Text size on a phone"
                          />
                        </label>
                        <label>
                          Page colour
                          <select
                            value={readerTheme}
                            onChange={(event) => setReaderTheme(event.target.value as ReaderTheme)}
                            aria-label="Page colour on a phone"
                          >
                            <option value="paper">Paper</option>
                            <option value="sepia">Sepia</option>
                            <option value="night">Night</option>
                            <option value="contrast">High contrast</option>
                          </select>
                        </label>
                        <button className="secondary-button" onClick={() => setWideLayout(true)}>
                          <Maximize2 size={14} /> Expand
                        </button>
                      </div>
                    ) : null}
                    {book.format === 'epub' ? (
                      <label className="reader-controls-check">
                        <input
                          type="checkbox"
                          checked={reading.tapZones}
                          onChange={(event) => onReadingChange({ tapZones: event.target.checked })}
                        />
                        Tap the top or bottom to turn the page
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </span>
            ) : null}
            {canPlayAmbient() ? (
              <span className="reader-ambient">
                <button
                  className={'icon-button' + (ambient.kind ? ' reader-listening' : '')}
                  onClick={() => setAmbientOpen((value) => !value)}
                  aria-label="Background sound"
                  aria-expanded={ambientOpen}
                  title="Background sound"
                >
                  <CloudRain size={16} />
                </button>
                {ambientOpen ? (
                  <div className="reader-ambient-pop">
                    {[{ id: null, label: 'Off' }, ...AMBIENT_OPTIONS].map((option) => (
                      <button
                        key={option.label}
                        className={ambient.kind === option.id ? 'reader-ambient-on' : ''}
                        onClick={() => chooseAmbient(option.id as AmbientKind | null)}
                      >
                        {option.label}
                      </button>
                    ))}
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={ambient.volume}
                      aria-label="Sound volume"
                      onChange={(event) => {
                        const volume = Number(event.target.value)
                        ambientRef.current?.setVolume(volume)
                        const next = { kind: ambient.kind, volume }
                        setAmbient(next)
                        writeAmbient(next)
                      }}
                    />
                  </div>
                ) : null}
              </span>
            ) : null}
            {book.format === 'epub' ? (
              <button className="icon-button" onClick={onRecap} aria-label="Where was I?" title="Where was I?">
                <History size={16} />
              </button>
            ) : null}
            {book.format === 'epub' && canListen() ? (
              <>
                <button
                  className={'icon-button' + (listening === 'on' ? ' reader-listening' : '')}
                  onClick={toggleListening}
                  aria-label={
                    listening === 'on' ? 'Pause listening' : listening === 'paused' ? 'Resume listening' : 'Listen'
                  }
                  title={listening === 'on' ? 'Pause' : listening === 'paused' ? 'Resume' : 'Listen to this chapter'}
                >
                  {listening === 'on' ? (
                    <Pause size={16} />
                  ) : listening === 'paused' ? (
                    <Play size={16} />
                  ) : (
                    <Headphones size={16} />
                  )}
                </button>
                {listening !== 'off' ? (
                  <button className="icon-button" onClick={stopListening} aria-label="Stop listening" title="Stop">
                    <Square size={14} />
                  </button>
                ) : null}
              </>
            ) : null}
            {book.format === 'epub' ? (
              <button
                className="icon-button"
                onClick={() => setSearchOpen((value) => !value)}
                aria-label="Search this book"
                aria-pressed={searchOpen}
              >
                <Search size={17} />
              </button>
            ) : null}
          </div>
        </div>
      )}
      {define ? (
        <div className="reader-define" role="status">
          {define.state === 'looking' ? <span>Looking up “{define.word}”…</span> : null}
          {define.state === 'missing' ? <span>No definition found for “{define.word}”.</span> : null}
          {define.state === 'error' ? (
            <span>{define.word ? 'The dictionary is unavailable right now.' : 'Select a single word first.'}</span>
          ) : null}
          {define.state === 'found' ? (
            <>
              <strong>
                {define.word} {define.phonetic ? <em>{define.phonetic}</em> : null}
              </strong>
              {define.meanings?.map((meaning, index) => (
                <p key={index}>
                  <em>{meaning.partOfSpeech}</em> {meaning.definition}
                </p>
              ))}
              <button
                className="text-button"
                onClick={() => {
                  onSaveWord(
                    define.word,
                    (define.meanings ?? []).map((m) => `${m.partOfSpeech}: ${m.definition}`).join('\n'),
                    currentNoteLocation(),
                  )
                  setDefine(null)
                }}
              >
                Save to my words
              </button>
            </>
          ) : null}
          <button className="text-button" onClick={() => setDefine(null)}>
            Close
          </button>
        </div>
      ) : null}
      {!wideLayout && book.format === 'epub' && searchOpen ? (
        <div className="reader-search">
          <Search size={15} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search this book"
            autoFocus
          />
          <span>
            {!searchReady
              ? 'Searches the whole book'
              : searching
                ? 'Searching…'
                : searchResults.length >= MAX_SEARCH_HITS
                  ? `${MAX_SEARCH_HITS}+ matches`
                  : `${searchResults.length} ${searchResults.length === 1 ? 'match' : 'matches'}`}
          </span>
        </div>
      ) : null}
      {!wideLayout && book.format === 'epub' && searchOpen && searchResults.length > 0 ? (
        <ul className="reader-search-results" aria-label="Search results">
          {searchResults.map((hit, index) => (
            <li key={`${hit.cfi}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  void rendition.current?.display(hit.cfi)
                }}
              >
                <strong>{hit.chapter}</strong>
                <span>{hit.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!wideLayout && book.format === 'epub' ? (
        <div className="reader-settings">
          <label>
            <Type size={14} />
            <span>Text</span>
            <input
              type="range"
              min="85"
              max="125"
              step="5"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              aria-label="Text size"
            />
          </label>
          <select
            value={readerTheme}
            onChange={(event) => setReaderTheme(event.target.value as ReaderTheme)}
            aria-label="Reader theme"
          >
            <option value="paper">Paper</option>
            <option value="sepia">Sepia</option>
            <option value="night">Night</option>
            <option value="contrast">High contrast</option>
          </select>
          <button className="secondary-button" onClick={() => setWideLayout(true)}>
            <Maximize2 size={14} /> Expand
          </button>
        </div>
      ) : null}
      {!wideLayout && book.format === 'epub' ? (
        <div className="reader-progress-row">
          <span>{pageNumber ? `Page ${pageNumber}` : 'Progress'}</span>
          <div className="reader-progress">
            <span style={{ width: String(visibleProgress) + '%' }} />
          </div>
          <strong>{visibleProgress}%</strong>
        </div>
      ) : null}
      <div className={'reader-workspace-grid' + (!wideLayout && !toolsOpen ? ' reader-rail-off' : '')}>
        {!wideLayout ? (
          <aside className="reader-chapter-rail" aria-label="Book contents">
            <div className="reader-rail-book">
              <BookCover book={book} compact />
              <div>
                <strong>{book.title}</strong>
                <span>{book.author}</span>
              </div>
            </div>
            <div className="reader-rail-heading">
              <span>Contents</span>
              <small>{chapterLabel}</small>
            </div>
            {book.format === 'epub' && toc.length > 0 ? (
              <div className="reader-chapter-list">
                {toc.map((item, index) => (
                  <button
                    key={item.href + '-' + item.label}
                    className={index === chapterIndex ? 'reader-chapter-active' : ''}
                    onClick={() => goToChapterRef.current(index)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="reader-rail-empty">This source has no chapter list. Keep reading in the center pane.</p>
            )}
          </aside>
        ) : null}
        <div
          ref={bodyRef}
          className={
            'reader-body ' +
            (book.format === 'pdf' ? 'reader-body-pdf' : '') +
            (external ? ' reader-body-web' : '') +
            (readerTheme === 'night'
              ? ' reader-theme-night'
              : readerTheme === 'sepia'
                ? ' reader-theme-sepia'
                : readerTheme === 'contrast'
                  ? ' reader-theme-contrast'
                  : '')
          }
        >
          {reading.dim > 0 ? (
            <div
              className="reader-dim"
              style={{ background: `rgba(0, 0, 0, ${reading.dim / 100})` }}
              aria-hidden="true"
            />
          ) : null}
          <div className={'reader-frame-wrap ' + (book.format === 'epub' ? 'reader-frame-epub' : '')}>
            {book.format === 'pdf' ? (
              pdfData ? (
                <PdfReader
                  data={pdfData}
                  book={book}
                  highlights={pdfHighlights}
                  startPage={pdfStart}
                  jumpPage={parsePdfLocation(jumpLocation?.cfi)?.page ?? jumpLocation?.page}
                  theme={readerTheme}
                  onPage={(page, total) => {
                    setPdfPage(page)
                    onProgress((page / total) * 100, `pdf:${page}`, undefined, `Page ${page}`, page - 1, 0)
                  }}
                  onHighlight={onHighlight}
                  onHighlightEdit={onHighlightEdit}
                  onNote={(text, location) => onNote(text, 'note', location)}
                  onAsk={(text, location) =>
                    onAsk('Explain the selected passage', { ...location, selectedText: text } as ReaderTutorContext)
                  }
                />
              ) : null
            ) : external ? (
              <iframe
                className="web-frame"
                src={book.readerUrl || book.sourceUrl}
                title={'Reading ' + book.title}
                allow="fullscreen"
              />
            ) : (
              <div ref={frame} className="reader-frame" />
            )}
            {chapterEnd !== null && !pick ? (
              <div className="reader-chapter-end" role="region" aria-label="End of chapter">
                <strong>{toc[chapterEnd]?.label ? `End of ${toc[chapterEnd].label}` : 'End of the chapter'}</strong>
                <div>
                  {chapterEnd + 1 < toc.length ? (
                    <button
                      className="primary-button"
                      onClick={() => {
                        const next = chapterEnd + 1
                        closeChapterEnd()
                        goToChapter(next)
                      }}
                    >
                      Next chapter
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    onClick={() => {
                      closeChapterEnd()
                      onNote('', 'reflect', currentNoteLocation())
                    }}
                  >
                    Keep a thought
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      closeChapterEnd()
                      onAsk(
                        'Recap this chapter in a few sentences, only up to where I have read.',
                        currentTutorContext(),
                      )
                    }}
                  >
                    Recap
                  </button>
                  <button className="icon-button" onClick={closeChapterEnd} aria-label="Dismiss">
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : null}
            {pick ? (
              <div className="reader-pick" role="toolbar" aria-label="Highlight">
                {HIGHLIGHT_COLORS.map((item) => (
                  <button
                    key={item.id}
                    className={'reader-pick-dot' + (pick.color === item.id ? ' reader-pick-dot-on' : '')}
                    style={{ background: item.css }}
                    aria-label={`${item.label} highlight`}
                    onClick={() => chooseColor(item.id)}
                  />
                ))}
                {pick.noteId ? (
                  <button
                    className="reader-pick-action"
                    onClick={() => {
                      onHighlightEdit(pick.noteId as string, null)
                      finishPick()
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  <>
                    <button
                      className="reader-pick-action"
                      onClick={() => {
                        onNote(pick.text, 'note', pick.location)
                        finishPick()
                      }}
                    >
                      Note
                    </button>
                    <button
                      className="reader-pick-action"
                      onClick={() => {
                        onAsk('Explain the selected passage', { ...pick.location, selectedText: pick.text })
                        finishPick()
                      }}
                    >
                      Ask Noema
                    </button>
                  </>
                )}
                <button className="reader-pick-action" onClick={finishPick} aria-label="Close">
                  <X size={14} />
                </button>
              </div>
            ) : null}
            {loading ? (
              <div className="reader-overlay">
                <Sparkles size={18} /> Opening {book.title}…
              </div>
            ) : null}
            {error ? (
              <div className="reader-overlay reader-error">
                <CircleHelp size={18} />
                <p>{error}</p>
              </div>
            ) : null}
          </div>
        </div>
        {!wideLayout ? (
          <aside className="reader-context-rail" aria-label="Reading context">
            <div className="reader-context-head">
              <span>Second Brain</span>
              <button
                className="icon-button tiny"
                onClick={() => onNote('', 'note', currentNoteLocation())}
                aria-label="Add note"
              >
                <Plus size={14} />
              </button>
            </div>
            <p className="reader-context-copy">Capture an idea while it is still close to the page.</p>
            <div className="reader-context-actions">
              <button onClick={() => onNote('', 'highlight', currentNoteLocation())}>
                <Highlighter size={13} /> Highlight
              </button>
              <button onClick={() => onNote('', 'question', currentNoteLocation())}>
                <MessageCircleQuestion size={13} /> Question
              </button>
              <button onClick={() => onNote('', 'reflect', currentNoteLocation())}>
                <Lightbulb size={13} /> Reflect
              </button>
              <button onClick={() => onNote('', 'connect', currentNoteLocation())}>
                <Link2 size={13} /> Connect
              </button>
            </div>
            <div className="reader-notes-heading">
              <span>From this book</span>
              <small>{bookNotes.length}</small>
            </div>
            {bookNotes.length > 0 ? (
              <div className="reader-note-list">
                {bookNotes.map((note) => (
                  <article key={note.id}>
                    <div className="reader-note-kind">
                      {noteIcon(note.kind)}
                      <span>{note.title}</span>
                    </div>
                    {note.quote ? <blockquote className="reader-note-quote">{note.quote}</blockquote> : null}
                    <p>{note.body}</p>
                    <small>{noteLocationLabel(note) || note.source}</small>
                    <button className="reader-note-open" onClick={() => onOpenNote(note)}>
                      <BookOpen size={11} /> Open in book
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="reader-rail-empty">Your highlights and reflections will stay here with this book.</p>
            )}
            <button
              className="reader-ask-button"
              onClick={() => onAsk('Explain the current page or selected passage', currentTutorContext())}
            >
              <Sparkles size={14} /> Ask Noema about this
            </button>
          </aside>
        ) : null}
      </div>
      {wideLayout && toolsOpen ? (
        <ReaderWideSidebar
          book={book}
          notes={bookNotes}
          location={{
            bookId: book.id,
            bookTitle: book.title,
            author: book.author,
            chapter: currentChapter.label,
            chapterIndex,
            page: pageNumber,
            href: currentChapter.href,
            cfi: book.cfi,
          }}
          onNote={onNote}
          onAsk={() => onAsk('Explain the current page or selected passage', currentTutorContext())}
          onClose={() => setToolsOpen(false)}
        />
      ) : null}
      {!wideLayout && book.format === 'epub' && chapterCount > 0 ? (
        <div className="reader-pager" aria-label="Chapters">
          <button
            className="reader-page-button"
            onClick={() => goToChapterRef.current(chapterIndex - 1)}
            disabled={chapterIndex <= 0}
            aria-label="Previous chapter"
          >
            <ArrowLeft size={18} />
          </button>
          <span>{chapterLabel}</span>
          <button
            className="reader-page-button"
            onClick={() => goToChapterRef.current(chapterIndex + 1)}
            disabled={chapterIndex >= chapterCount - 1}
            aria-label="Next chapter"
          >
            <ArrowRight size={18} />
          </button>
        </div>
      ) : null}
      {wideLayout ? (
        <div className="reader-wide-footer">
          <button
            className="reader-page-button"
            onClick={() => goToChapterRef.current(chapterIndex - 1)}
            disabled={book.format !== 'epub' || chapterIndex <= 0}
            aria-label="Previous chapter"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="reader-wide-location">
            <span>Select chapter</span>
            <select
              className="reader-wide-chapter-select"
              value={currentChapter.href}
              onChange={(event) => handleChapterSelect(event.target.value)}
              disabled={chapterCount === 0}
              aria-label="Select chapter"
            >
              {chapterCount === 0 ? (
                <option value="">Opening</option>
              ) : (
                toc.map((item) => (
                  <option key={item.href + '-' + item.label} value={item.href}>
                    {item.label}
                  </option>
                ))
              )}
            </select>
            <small>{chapterLabel}</small>
          </div>
          <button
            className="reader-page-button"
            onClick={() => goToChapterRef.current(chapterIndex + 1)}
            disabled={book.format !== 'epub' || chapterIndex >= chapterCount - 1}
            aria-label="Next chapter"
          >
            <ArrowRight size={22} />
          </button>
        </div>
      ) : null}
    </section>
  )
}

function ReaderWideSidebar({
  book,
  notes,
  location,
  onNote,
  onAsk,
  onClose,
}: {
  book: LibraryBook
  notes: Note[]
  location: BrainNoteLocation
  onNote: ReaderNoteHandler
  onAsk: () => void
  onClose: () => void
}) {
  return (
    <aside className="reader-wide-sidebar" aria-label="Reading tools">
      <div className="reader-wide-sidebar-head">
        <div>
          <h2>Second Brain</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close reading tools">
          <X size={16} />
        </button>
      </div>

      <div className="reader-wide-sidebar-actions">
        <button onClick={() => onNote('', 'highlight', location)}>
          <Highlighter size={14} /> Highlight
        </button>
        <button onClick={() => onNote('', 'note', location)}>
          <FileText size={14} /> Note
        </button>
        <button onClick={() => onNote('', 'question', location)}>
          <MessageCircleQuestion size={14} /> Question
        </button>
        <button onClick={() => onNote('', 'reflect', location)}>
          <Lightbulb size={14} /> Reflect
        </button>
      </div>
      <div className="reader-wide-sidebar-section">
        <div className="reader-wide-sidebar-label">
          <span>From this book</span>
          <small>{notes.length}</small>
        </div>
        {notes.length ? (
          notes.slice(0, 4).map((note) => (
            <article className="reader-wide-note" key={note.id}>
              <strong>{note.title}</strong>
              <p>{note.body}</p>
              <small>
                {note.chapter || book.chapter || 'Current location'}
                {note.page ? ` · p. ${note.page}` : ''}
              </small>
            </article>
          ))
        ) : (
          <p className="reader-wide-empty">Your captured thoughts will stay connected to this chapter.</p>
        )}
      </div>
      <div className="reader-wide-tutor">
        <div>
          <Sparkles size={15} />
          <strong>Noema</strong>
        </div>
        <p>Ask about the page you are reading.</p>
        <button className="secondary-button" onClick={onAsk}>
          Ask Noema <ArrowRight size={13} />
        </button>
      </div>
    </aside>
  )
}
