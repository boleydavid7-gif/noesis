import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Brain,
  CircleHelp,
  FileText,
  Highlighter,
  Lightbulb,
  Link2,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  Plus,
  Search,
  Sparkles,
  Type,
} from 'lucide-react'
import { BookCover } from './BookCover'
import { friendlyBookError } from './lib/text'
import type { BrainNote, BrainNoteKind, BrainNoteLocation } from './lib/knowledge'
import { openEpub, spineSections } from './lib/epub'
import { loadEpubFile, type LibraryBook } from './lib/library'
import { useLatest } from './lib/useLatest'

type Note = BrainNote
type SearchHit = { cfi: string; excerpt: string; chapter: string }
const MAX_SEARCH_HITS = 40
export type NoteAction = 'highlight' | 'note' | 'question' | 'reflect' | 'connect'
export type ReaderNoteHandler = (text: string, kind?: NoteAction, location?: BrainNoteLocation) => void

type ReaderTheme = 'paper' | 'sepia' | 'night'
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

export function Reader({
  book,
  notes,
  onClose,
  onProgress,
  onNote,
  onOpenNote,
  onAsk,
  onBookmark,
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
  onBookmark: () => void
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
  const [pdfUrl, setPdfUrl] = useState('')
  const [fontSize, setFontSize] = useState(100)
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('paper')
  const [wideLayout, setWideLayout] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
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
    page: locationRef.current.page,
    href: locationRef.current.href ?? currentChapter.href,
    cfi: locationRef.current.cfi,
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
  useEffect(() => {
    if (!wideLayout) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
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
    const { onProgress: reportProgress, onNote: saveHighlight } = readerCallbacksRef.current
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
          const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
          if (!cancelled) {
            setPdfUrl(url)
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
        let generatedLocationCount = 0
        try {
          await epub.locations.generate(1200)
          generatedLocationCount = epub.locations.length()
        } catch {
          // Some EPUBs do not expose enough text for generated locations. The
          // rendition's displayed page metadata remains the source of truth.
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
              (initialIndexByHref >= 0 ? initialIndexByHref : 0),
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
          const selectionKind = wideLayoutRef.current ? wideCaptureKindRef.current : 'highlight'
          saveHighlight(text, selectionKind, {
            bookId: currentBook.id,
            bookTitle: currentBook.title,
            author: currentBook.author,
            chapter: chapters[activeChapterIndex]?.label ?? currentBook.chapter,
            chapterIndex: activeChapterIndex,
            page: selectionPage,
            href: locationRef.current.href ?? chapters[activeChapterIndex]?.href,
            cfi: cfiRange,
          })
        })
        const firstChapter = chapters[initialIndex]?.href
        const savedLocation = targetLocation?.cfi || targetLocation?.href || currentBook.cfi || currentBook.currentHref
        let opened = false
        if (firstChapter) {
          try {
            // Open through the same chapter href used by the chapter menu. This
            // gives new books a reliable first view before restoring a saved spot.
            await instance.display(firstChapter)
            opened = true
          } catch {
            // A malformed first navigation entry can still be recoverable through
            // the saved location or the first spine entry below.
          }
        }
        if (savedLocation && savedLocation !== firstChapter) {
          try {
            await instance.display(savedLocation)
            opened = true
          } catch {
            // Reopen the known chapter if an old CFI or href cleared the view.
            if (firstChapter) {
              try {
                await instance.display(firstChapter)
              } catch {
                /* surface the original opening error below */
              }
            }
          }
        }
        if (!opened) throw new Error('This EPUB has no readable opening chapter.')
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
  }, [book.id, bookRef, readerCallbacksRef, wideLayoutRef, wideCaptureKindRef, jumpLocation])
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
    const colors =
      readerTheme === 'night'
        ? { background: '#111a22', color: '#dce8f2' }
        : readerTheme === 'sepia'
          ? { background: '#f1e6d0', color: '#4b3b2c' }
          : { background: '#f6f2e9', color: '#233a4e' }
    current.themes.fontSize(`${fontSize}%`)
    current.themes.override('background-color', colors.background, true)
    current.themes.override('color', colors.color, true)
    current.themes.override('line-height', '1.65', true)
  }, [book.format, fontSize, readerTheme])
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
        <div className="reader-wide-topbar" aria-label="Focus reader controls">
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
              aria-label="Exit focus reader"
              title="Exit focus reader"
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
          </select>
          <button className="secondary-button" onClick={() => setWideLayout(true)}>
            <Maximize2 size={14} /> Wide
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
      <div className="reader-workspace-grid">
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
          className={
            'reader-body ' +
            (book.format === 'pdf' ? 'reader-body-pdf' : '') +
            (external ? ' reader-body-web' : '') +
            (readerTheme === 'night' ? ' reader-theme-night' : readerTheme === 'sepia' ? ' reader-theme-sepia' : '')
          }
        >
          <div className={'reader-frame-wrap ' + (book.format === 'epub' ? 'reader-frame-epub' : '')}>
            {book.format === 'pdf' ? (
              <iframe className="pdf-frame" src={pdfUrl} title={'Reading ' + book.title} />
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
      {wideLayout ? (
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
        />
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
}: {
  book: LibraryBook
  notes: Note[]
  location: BrainNoteLocation
  onNote: ReaderNoteHandler
  onAsk: () => void
}) {
  return (
    <aside className="reader-wide-sidebar" aria-label="Reading tools">
      <div className="reader-wide-sidebar-head">
        <div>
          <p className="eyebrow">Study beside the page</p>
          <h2>Second Brain</h2>
        </div>
        <Brain size={18} />
      </div>
      <p className="reader-wide-sidebar-copy">Capture ideas without leaving your reading space.</p>
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
