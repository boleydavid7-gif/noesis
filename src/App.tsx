import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, Brain, Bookmark, CalendarDays, CheckCircle2, Circle, CircleHelp, Cloud, CloudSun, Download, FileText, Highlighter, Home, Library, ListChecks,
  Link2, Lightbulb, Maximize2, Menu, MessageCircleQuestion, Minimize2, MoreVertical, Plus, RotateCcw, Search, Settings,
  Sparkles, Trash2, Type, Upload, UserRound, X,
} from 'lucide-react'
import './App.css'
import { hydrateRemoteNotes, persistNote, readLocalNotes, syncPendingNotes, type BrainNote, type BrainNoteKind, type BrainNoteLocation } from './lib/knowledge'
import { epubBookFromParsed, openEpub, parseEpub, pdfBookFromSource } from './lib/epub'
import { loadBookText, loadEpubFile, readLibraryBooks, removeLibraryBook, saveBookText, saveEpubFile, upsertLibraryBook, writeLibraryBooks, type LibraryBook } from './lib/library'
import { downloadBackup as downloadBackupFile, restoreBackup } from './lib/backup'
import { bindCloudConnectionsToUser, cloudConnectionForUser, connectCloudProvider, consumeCloudOAuthRedirect, disconnectCloudProvider, listCloudProviders, readCloudConnections, type CloudConnection, type CloudProviderId } from './lib/cloudProviders'
import { syncCloudState } from './lib/cloudSync'
import { writeLocalNotes } from './lib/knowledge'
import { getCurrentSession, isAnonymousUser, sendPasswordReset, signInWithPassword, signOut, signUpWithPassword, subscribeToAuth, updateProfileName, upgradeAnonymousAccount } from './lib/auth'
import type { User } from '@supabase/supabase-js'

type Note = BrainNote
type Overlay = 'brain' | 'noema' | null
type SelectionOffer = { text: string; top: number; left: number }
type NoteDraft = { title: string; body: string; source: string; kind: BrainNoteKind; location?: BrainNoteLocation }
type NoteAction = 'highlight' | 'note' | 'question' | 'reflect' | 'connect'
type ReaderNoteHandler = (text: string, kind?: NoteAction, location?: BrainNoteLocation) => void
type LibrarySort = 'recent' | 'title' | 'progress'
type LearningPath = { id: string; title: string; description: string; bookIds: string[]; createdAt: string }
type Resource = { id: string; title: string; author: string; year?: number; coverUrl?: string; description?: string; source: string; sourceUrl: string; downloadUrl?: string; readerUrl?: string; accessType?: 'public' | 'borrow'; free: boolean; format: string; kind: 'book' | 'article' }

const PATHS_KEY = 'noesis:paths:v1'
const PROFILE_NAME_KEY = 'noesis:profile:first-name:v1'
const navItems = [
  { label: 'Home', text: 'Home', icon: Home }, { label: 'My Library', text: 'Library', icon: Library },
  { label: 'Read', text: 'Read', icon: BookOpen }, { label: 'Notes', text: 'Second Brain', icon: Brain },
  { label: 'Learning Paths', text: 'Paths', icon: ListChecks }, { label: 'Explore', text: 'Explore', icon: Search },
  { label: 'Cloud Backup', text: 'Settings', icon: Settings }, { label: 'Account', text: 'Account', icon: UserRound },
]

function readPaths(): LearningPath[] {
  try { const value = JSON.parse(localStorage.getItem(PATHS_KEY) ?? '[]') as unknown; return Array.isArray(value) ? value as LearningPath[] : [] } catch { return [] }
}
function writePaths(paths: LearningPath[]) { localStorage.setItem(PATHS_KEY, JSON.stringify(paths)) }
function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
function readProfileName(userId?: string): string {
  try { return localStorage.getItem(userId ? `${PROFILE_NAME_KEY}:${userId}` : PROFILE_NAME_KEY)?.trim() ?? '' } catch { return '' }
}
function writeProfileName(value: string, userId?: string) {
  try { localStorage.setItem(userId ? `${PROFILE_NAME_KEY}:${userId}` : PROFILE_NAME_KEY, value.trim()) } catch { /* local storage can be unavailable in private browsing */ }
}
function firstNameFromValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const first = value.trim().split(/\s+/)[0]
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
}
function displayNameFor(user: User | null, preferred = ''): string {
  if (preferred.trim()) return firstNameFromValue(preferred)
  if (!user) return firstNameFromValue(readProfileName())
  const metadata = user.user_metadata as Record<string, unknown> | undefined
  const name = [metadata?.first_name, metadata?.given_name, metadata?.full_name, metadata?.name, metadata?.display_name].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (name) return firstNameFromValue(name)
  const emailName = user.email?.split('@')[0].replace(/[._-]+/g, ' ').trim() ?? ''
  return firstNameFromValue(emailName)
}
function friendlyBookError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : ''
  if (/zip|slice|central directory|corrupt|invalid/i.test(message)) return 'Noesis could not open this EPUB. Make sure it is a complete, DRM-free .epub file, not a preview page.'
  return message || fallback
}
function relevantExcerpt(text: string, question: string, limit = 30_000): string {
  if (text.length <= limit) return text
  const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3)
  const lower = text.toLowerCase()
  const position = terms.map((term) => lower.indexOf(term)).filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, Math.min(position - Math.floor(limit * .22), text.length - limit))
  return `${start > 0 ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`
}
function BookCover({ book, compact = false }: { book: LibraryBook; compact?: boolean }) {
  const image = book.coverDataUrl || book.coverUrl
  return <div className={`book-cover ${compact ? 'book-cover-compact' : ''} ${image ? 'book-cover-image' : ''}`} aria-label={book.title} style={image ? { backgroundImage: `url(${image})` } : undefined}>{!image ? <div className="book-cover-mark">N</div> : null}</div>
}
function NoesisMark({ size = 22 }: { size?: number }) {
  return <svg className="noesis-mark" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M9 17.5c8.5-3 16.2-2.1 23 3.6v31.2c-6.8-5.5-14.5-6.7-23-3.7V17.5Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" /><path d="M55 17.5c-8.5-3-16.2-2.1-23 3.6v31.2c6.8-5.5 14.5-6.7 23-3.7V17.5Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" /><path d="M32 21.5v30.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /><path d="M32 44c.2-7.8 3.5-13.3 9.6-17" stroke="var(--mark-accent, #d5ab61)" strokeWidth="2.2" strokeLinecap="round" /><path d="m42.3 11.5 1.7 4.6 4.6 1.7-4.6 1.7-1.7 4.6-1.7-4.6-4.6-1.7 4.6-1.7 1.7-4.6Z" stroke="var(--mark-accent, #d5ab61)" strokeWidth="1.9" strokeLinejoin="round" /></svg>
}
function ProgressRing({ value }: { value: number }) { return <div className="progress-ring" style={{ '--progress': `${Math.max(0, Math.min(100, value)) * 3.6}deg` } as React.CSSProperties}><span>{Math.round(value)}%</span></div> }

function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return ref
}

type ReaderTheme = 'paper' | 'sepia' | 'night'
type PageDirection = 'next' | 'previous'
type ReaderChapter = { label: string; href: string }
type ReaderLocation = { start?: { index?: number; location?: number; percentage?: number; cfi?: string; href?: string; displayed?: { page?: number; total?: number } } }
type ReaderTutorContext = BrainNoteLocation & { visibleText?: string; selectedText?: string }
type TutorHandler = (prompt: string, context?: ReaderTutorContext) => void

function normalizeReaderText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
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
    const max = scrollingElement?.scrollHeight ? Math.max(1, scrollingElement.scrollHeight - scrollingElement.clientHeight) : 1
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

function Reader({ book, notes, onClose, onProgress, onNote, onOpenNote, onAsk, onBookmark, initialLocation: jumpLocation }: { book: LibraryBook; notes: Note[]; onClose: () => void; onProgress: (progress: number, cfi?: string, href?: string, chapter?: string, chapterIndex?: number, chapterProgress?: number) => void; onNote: ReaderNoteHandler; onOpenNote: (note: Note) => void; onAsk: TutorHandler; onBookmark: () => void; initialLocation?: BrainNoteLocation | null }) {
  const frame = useRef<HTMLDivElement>(null)
  const rendition = useRef<Awaited<ReturnType<typeof openEpub>>['renderTo'] extends (...args: never[]) => infer R ? R : never>(null)
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
  const [bookText, setBookText] = useState('')
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
  const overallProgress = (index: number, fraction: number, count = chapterCount) => count > 0 ? Math.round(((Math.max(0, Math.min(index, count - 1)) + clampFraction(fraction)) / count) * 100) : Math.round(clampFraction(fraction) * 100)
  const visibleProgress = chapterCount > 0 ? overallProgress(chapterIndex, chapterProgress) : Math.round(book.progress)
  const currentNoteLocation = (): BrainNoteLocation => ({ bookId: book.id, bookTitle: book.title, author: book.author, chapter: currentChapter.label, chapterIndex, page: locationRef.current.page, href: locationRef.current.href ?? currentChapter.href, cfi: locationRef.current.cfi })
  const currentTutorContext = (): ReaderTutorContext => {
    const location = currentNoteLocation()
    const iframe = frame.current?.querySelector('iframe')
    const selectedText = iframe?.contentWindow?.getSelection()?.toString().trim() || selectedTextRef.current
    return { ...location, selectedText: selectedText || undefined, visibleText: extractVisibleReaderText(frame.current) || undefined }
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
  const searchCount = useMemo(() => { const query = searchTerm.trim().toLowerCase(); if (!query || !bookText) return 0; return bookText.toLowerCase().split(query).length - 1 }, [bookText, searchTerm])
  const searchSnippet = useMemo(() => { const query = searchTerm.trim().toLowerCase(); const index = query && bookText ? bookText.toLowerCase().indexOf(query) : -1; return index >= 0 ? `${index > 90 ? '…' : ''}${bookText.slice(Math.max(0, index - 90), index + query.length + 170)}…` : '' }, [bookText, searchTerm])
  useEffect(() => {
    if (!wideLayout) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
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
    return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); observer?.disconnect(); window.removeEventListener('resize', resize) }
  }, [book.format, wideLayout, loading])
  useEffect(() => {
    let cancelled = false
    let cleanupReading = () => undefined
    const currentBook = bookRef.current
    const { onProgress: reportProgress, onNote: saveHighlight } = readerCallbacksRef.current
    const isExternal = currentBook.format === 'web' || currentBook.format === 'resource'
    const start = async () => {
      setLoading(true); setError('')
      try {
        if (isExternal) { setLoading(false); return }
        const data = await loadEpubFile(currentBook.id)
        if (!data) throw new Error('This EPUB is no longer stored on this device. Import it again to continue reading.')
        if (currentBook.format === 'pdf') { const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' })); if (!cancelled) { setPdfUrl(url); setLoading(false) }; return }
        const epub = await openEpub(data)
        if (cancelled || !frame.current) { epub.destroy(); return }
        epubRef.current = epub
        const navigation = await epub.loaded.navigation
        const navigationChapters = chapterEntries(navigation.toc)
        const spineItems = await epub.loaded.spine
        const spineChapters = asArray(spineItems).flatMap((entry, index) => {
          if (!entry || typeof entry !== 'object') return []
          const record = entry as { href?: unknown; url?: unknown }
          const href = typeof record.href === 'string' ? record.href.trim() : typeof record.url === 'string' ? record.url.trim() : ''
          return href ? [{ label: `Chapter ${index + 1}`, href }] : []
        })
        const savedChapters = chapterEntries(currentBook.toc)
        const chapters = savedChapters.length > 0 ? savedChapters : navigationChapters.length > 0 ? navigationChapters : spineChapters
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
        const initialIndexByHref = savedHref ? chapters.findIndex((item) => savedHref.includes(item.href.split('#')[0])) : -1
        const initialIndex = Math.max(0, Math.min(chapters.length - 1, targetLocation?.chapterIndex ?? currentBook.chapterIndex ?? (initialIndexByHref >= 0 ? initialIndexByHref : 0)))
        const initialChapterProgress = clampFraction(currentBook.chapterProgress ?? (chapters.length > 0 ? ((currentBook.progress / 100) * chapters.length) - initialIndex : currentBook.progress / 100))
        locationRef.current = { page: targetLocation?.page, href: targetLocation?.href ?? currentBook.currentHref, cfi: targetLocation?.cfi ?? currentBook.cfi }
        setPageNumber(targetLocation?.page)
        setToc(chapters); setChapterIndex(initialIndex); setChapterProgress(initialChapterProgress)
        const instance = epub.renderTo(frame.current, { width: '100%', height: '100%', flow: 'scrolled-doc', spread: 'none' }); rendition.current = instance
        let activeChapterIndex = initialIndex
        let scrollTimer: number | undefined
        const scrollTargets = new Set<EventTarget>()
        const scrollFraction = (target: EventTarget | null): number | undefined => {
          const element = target instanceof Document ? target.scrollingElement ?? target.documentElement : target instanceof HTMLElement ? target : null
          if (!element) return undefined
          const max = element.scrollHeight - element.clientHeight
          return max > 0 ? clampFraction(element.scrollTop / max) : undefined
        }
        const activeFraction = () => {
          const iframe = frame.current?.querySelector('iframe')
          const contentDocument = iframe?.contentDocument
          const targets: EventTarget[] = [contentDocument?.scrollingElement, contentDocument?.documentElement, contentDocument?.body, frame.current?.querySelector('.epub-container')].filter(Boolean) as EventTarget[]
          const values = targets.map((target) => scrollFraction(target)).filter((value): value is number => value !== undefined)
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
          const displayedFraction = displayed?.total && displayed.total > 0 ? ((displayed.page ?? 1) - 1) / displayed.total : undefined
          const fraction = clampFraction(fractionOverride ?? activeFraction() ?? displayedFraction ?? location.start.percentage ?? 0)
          const label = chapters[nextIndex]?.label ?? currentBook.chapter
          const progress = overallProgress(nextIndex, fraction, chapters.length)
          const generatedLocation = location.start.cfi && generatedLocationCount > 0 ? epub.locations.locationFromCfi(location.start.cfi) as unknown as number : -1
          const generatedPage = Number.isFinite(generatedLocation) && generatedLocation >= 0 ? generatedLocation + 1 : undefined
          const page = displayed?.page ?? generatedPage
          locationRef.current = { page, href: location.start.href ?? chapters[nextIndex]?.href, cfi: location.start.cfi }
          setPageNumber(page)
          setChapterIndex(nextIndex); setChapterProgress(fraction)
          reportProgress(progress, location.start.cfi, location.start.href ?? chapters[nextIndex]?.href, label, nextIndex, fraction)
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
          attachScroll(contentDocument); attachScroll(contentDocument.scrollingElement); attachScroll(contentDocument.documentElement); attachScroll(contentDocument.body)
        }
        instance.on('relocated', (location: ReaderLocation) => reportLocation(location))
        instance.on('rendered', attachView)
        instance.on('selected', (cfiRange: string, contents: { window?: Window }) => { const text = contents.window?.getSelection()?.toString().trim() ?? ''; if (!text) return; selectedTextRef.current = text; const selectionLocation = cfiRange && generatedLocationCount > 0 ? epub.locations.locationFromCfi(cfiRange) as unknown as number : -1; const selectionPage = locationRef.current.page ?? (Number.isFinite(selectionLocation) && selectionLocation >= 0 ? selectionLocation + 1 : undefined); const selectionKind = wideLayoutRef.current ? wideCaptureKindRef.current : 'highlight'; saveHighlight(text, selectionKind, { bookId: currentBook.id, bookTitle: currentBook.title, author: currentBook.author, chapter: chapters[activeChapterIndex]?.label ?? currentBook.chapter, chapterIndex: activeChapterIndex, page: selectionPage, href: locationRef.current.href ?? chapters[activeChapterIndex]?.href, cfi: cfiRange }) })
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
              try { await instance.display(firstChapter) } catch { /* surface the original opening error below */ }
            }
          }
        }
        if (!opened) throw new Error('This EPUB has no readable opening chapter.')
        const iframe = frame.current?.querySelector('iframe')
        if (iframe?.contentDocument) attachView(undefined, { contents: { document: iframe.contentDocument } })
        const initialLocation = instance.currentLocation() as ReaderLocation | Promise<ReaderLocation> | undefined
        void Promise.resolve(initialLocation).then((location) => reportLocation(location, initialChapterProgress))
        cleanupReading = () => { if (scrollTimer) window.clearTimeout(scrollTimer); scrollTargets.forEach((target) => target.removeEventListener('scroll', handleScroll)); scrollTargets.clear() }
      } catch (reason) { if (!cancelled) setError(friendlyBookError(reason, 'Could not open this EPUB.')) } finally { if (!cancelled) setLoading(false) }
    }
    void start()
    return () => { cancelled = true; cleanupReading(); rendition.current?.destroy(); epubRef.current?.destroy(); rendition.current = null; epubRef.current = null }
  }, [book.id, bookRef, readerCallbacksRef, wideLayoutRef, wideCaptureKindRef, jumpLocation])
  useEffect(() => { if (book.format !== 'epub') return; let active = true; void loadBookText(book.id).then((value) => { if (active) setBookText(value ?? '') }).catch(() => undefined); return () => { active = false } }, [book.id, book.format])
  useEffect(() => { const current = rendition.current; if (!current || book.format !== 'epub') return; const colors = readerTheme === 'night' ? { background: '#111a22', color: '#dce8f2' } : readerTheme === 'sepia' ? { background: '#f1e6d0', color: '#4b3b2c' } : { background: '#f6f2e9', color: '#233a4e' }; current.themes.fontSize(`${fontSize}%`); current.themes.override('background-color', colors.background, true); current.themes.override('color', colors.color, true); current.themes.override('line-height', '1.65', true) }, [book.format, fontSize, readerTheme])
  const handleChapterSelect = (href: string) => { const index = toc.findIndex((item) => item.href === href); if (index >= 0) goToChapterRef.current(index) }
  const chapterLabel = chapterCount > 0 ? `${chapterIndex + 1} of ${chapterCount}` : 'Opening'
  const bookNotes = notes.filter((note) => note.bookId === book.id || note.source.toLowerCase().includes(book.title.toLowerCase())).slice(0, 5)
  const noteIcon = (kind: BrainNoteKind) => kind === 'highlight' ? <Highlighter size={13} /> : kind === 'question' ? <MessageCircleQuestion size={13} /> : kind === 'idea' ? <Lightbulb size={13} /> : kind === 'connection' ? <Link2 size={13} /> : <FileText size={13} />
  const noteLocationLabel = (note: Note) => [note.chapter, note.page ? `p. ${note.page}` : ''].filter(Boolean).join(' · ')
  return <section className={'reader-page panel-card ' + (wideLayout ? 'reader-page-wide' : '') + (pageTurn ? ' reader-page-turn-' + pageTurn : '')}>
    {wideLayout ? <div className="reader-wide-topbar" aria-label="Focus reader controls"><div className="reader-wide-capture"><span>Capture</span><select value={wideCaptureKind} onChange={(event) => setWideCaptureKind(event.target.value as NoteAction)} aria-label="Choose what to capture"><option value="highlight">Highlight</option><option value="note">Note</option><option value="question">Question</option><option value="reflect">Reflect</option><option value="connect">Connect</option></select><small>{pageNumber ? `p. ${pageNumber}` : chapterLabel}</small><button className="reader-wide-capture-button" onClick={() => onNote('', wideCaptureKind, currentNoteLocation())} aria-label={`Open Second Brain for ${wideCaptureKind}`} title={`Capture ${wideCaptureKind} at ${pageNumber ? `page ${pageNumber}` : 'this location'}`}><Brain size={16} /></button></div><div className="reader-wide-actions"><button className="icon-button" onClick={() => onAsk('Explain the current page or selected passage', currentTutorContext())} aria-label="Ask Noema about this page" title="Ask Noema about this page"><Sparkles size={18} /></button><button className="icon-button" onClick={() => setWideLayout(false)} aria-label="Exit focus reader" title="Exit focus reader"><Minimize2 size={18} /></button></div></div> : <div className="reader-toolbar"><button className="secondary-button" onClick={onClose}><ArrowLeft size={15} /> Library</button><div className="reader-title"><strong>{book.title}</strong><span>{book.format === 'pdf' ? 'PDF document' : external ? (book.accessType === 'borrow' ? 'Borrowed' : 'Hosted') + ' reading source' : currentChapter.label}</span></div><div className="reader-controls">{book.format === 'epub' ? <select className="reader-contents-select" value={currentChapter.href} onChange={(event) => handleChapterSelect(event.target.value)} aria-label="Contents">{toc.length === 0 ? <option value="">Contents</option> : toc.map((item) => <option key={item.href + '-' + item.label} value={item.href}>{item.label}</option>)}</select> : null}<button className={'icon-button' + (book.bookmarked ? ' reader-bookmarked' : '')} onClick={onBookmark} aria-label={book.bookmarked ? 'Remove bookmark' : 'Bookmark this location'} aria-pressed={Boolean(book.bookmarked)}><Bookmark size={16} fill={book.bookmarked ? 'currentColor' : 'none'} /></button>{book.format === 'epub' ? <button className="icon-button" onClick={() => setSearchOpen((value) => !value)} aria-label="Search this book" aria-pressed={searchOpen}><Search size={17} /></button> : null}</div></div>}
    {!wideLayout && book.format === 'epub' && searchOpen ? <div className="reader-search"><Search size={15} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search this book" autoFocus /><span>{searchTerm.trim() ? (bookText ? searchCount + ' ' + (searchCount === 1 ? 'match' : 'matches') : 'Preparing search…') : 'Searches the imported text'}</span></div> : null}
    {!wideLayout && book.format === 'epub' && searchOpen && searchSnippet ? <div className="reader-search-result">{searchSnippet}</div> : null}
    {!wideLayout && book.format === 'epub' ? <div className="reader-settings"><label><Type size={14} /><span>Text</span><input type="range" min="85" max="125" step="5" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Text size" /></label><select value={readerTheme} onChange={(event) => setReaderTheme(event.target.value as ReaderTheme)} aria-label="Reader theme"><option value="paper">Paper</option><option value="sepia">Sepia</option><option value="night">Night</option></select><button className="secondary-button" onClick={() => setWideLayout(true)}><Maximize2 size={14} /> Wide</button></div> : null}
    {!wideLayout && book.format === 'epub' ? <div className="reader-progress-row"><span>{pageNumber ? `Page ${pageNumber}` : 'Progress'}</span><div className="reader-progress"><span style={{ width: String(visibleProgress) + '%' }} /></div><strong>{visibleProgress}%</strong></div> : null}
    <div className="reader-workspace-grid">
      {!wideLayout ? <aside className="reader-chapter-rail" aria-label="Book contents">
        <div className="reader-rail-book"><BookCover book={book} compact /><div><strong>{book.title}</strong><span>{book.author}</span></div></div>
        <div className="reader-rail-heading"><span>Contents</span><small>{chapterLabel}</small></div>
        {book.format === 'epub' && toc.length > 0 ? <div className="reader-chapter-list">{toc.map((item, index) => <button key={item.href + '-' + item.label} className={index === chapterIndex ? 'reader-chapter-active' : ''} onClick={() => goToChapterRef.current(index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong></button>)}</div> : <p className="reader-rail-empty">This source has no chapter list. Keep reading in the center pane.</p>}
      </aside> : null}
      <div className={'reader-body ' + (book.format === 'pdf' ? 'reader-body-pdf' : '') + (external ? ' reader-body-web' : '') + (readerTheme === 'night' ? ' reader-theme-night' : readerTheme === 'sepia' ? ' reader-theme-sepia' : '')}>
        <div className={'reader-frame-wrap ' + (book.format === 'epub' ? 'reader-frame-epub' : '')}>
          {book.format === 'pdf' ? <iframe className="pdf-frame" src={pdfUrl} title={'Reading ' + book.title} /> : external ? <iframe className="web-frame" src={book.readerUrl || book.sourceUrl} title={'Reading ' + book.title} allow="fullscreen" /> : <div ref={frame} className="reader-frame" />}
          {loading ? <div className="reader-overlay"><Sparkles size={18} /> Opening {book.title}…</div> : null}
          {error ? <div className="reader-overlay reader-error"><CircleHelp size={18} /><p>{error}</p></div> : null}
        </div>
      </div>
      {!wideLayout ? <aside className="reader-context-rail" aria-label="Reading context">
        <div className="reader-context-head"><span>Second Brain</span><button className="icon-button tiny" onClick={() => onNote('', 'note', currentNoteLocation())} aria-label="Add note"><Plus size={14} /></button></div>
        <p className="reader-context-copy">Capture an idea while it is still close to the page.</p>
        <div className="reader-context-actions"><button onClick={() => onNote('', 'highlight', currentNoteLocation())}><Highlighter size={13} /> Highlight</button><button onClick={() => onNote('', 'question', currentNoteLocation())}><MessageCircleQuestion size={13} /> Question</button><button onClick={() => onNote('', 'reflect', currentNoteLocation())}><Lightbulb size={13} /> Reflect</button><button onClick={() => onNote('', 'connect', currentNoteLocation())}><Link2 size={13} /> Connect</button></div>
        <div className="reader-notes-heading"><span>From this book</span><small>{bookNotes.length}</small></div>
        {bookNotes.length > 0 ? <div className="reader-note-list">{bookNotes.map((note) => <article key={note.id}><div className="reader-note-kind">{noteIcon(note.kind)}<span>{note.title}</span></div><p>{note.body}</p><small>{noteLocationLabel(note) || note.source}</small><button className="reader-note-open" onClick={() => onOpenNote(note)}><BookOpen size={11} /> Open in book</button></article>)}</div> : <p className="reader-rail-empty">Your highlights and reflections will stay here with this book.</p>}
        <button className="reader-ask-button" onClick={() => onAsk('Explain the current page or selected passage', currentTutorContext())}><Sparkles size={14} /> Ask Noema about this</button>
      </aside> : null}
    </div>
    {wideLayout ? <div className="reader-wide-footer"><button className="reader-page-button" onClick={() => goToChapterRef.current(chapterIndex - 1)} disabled={book.format !== 'epub' || chapterIndex <= 0} aria-label="Previous chapter"><ArrowLeft size={22} /></button><div className="reader-wide-location"><span>Select chapter</span><select className="reader-wide-chapter-select" value={currentChapter.href} onChange={(event) => handleChapterSelect(event.target.value)} disabled={chapterCount === 0} aria-label="Select chapter">{chapterCount === 0 ? <option value="">Opening</option> : toc.map((item) => <option key={item.href + '-' + item.label} value={item.href}>{item.label}</option>)}</select><small>{chapterLabel}</small></div><button className="reader-page-button" onClick={() => goToChapterRef.current(chapterIndex + 1)} disabled={book.format !== 'epub' || chapterIndex >= chapterCount - 1} aria-label="Next chapter"><ArrowRight size={22} /></button></div> : null}
  </section>
}
function App() {
  const [books, setBooks] = useState<LibraryBook[]>(() => readLibraryBooks()); const [notes, setNotes] = useState<Note[]>(() => readLocalNotes()); const [paths, setPaths] = useState<LearningPath[]>(() => readPaths())
  const [now, setNow] = useState(() => new Date())
  const [activeNav, setActiveNav] = useState('Home'); const [libraryQuery, setLibraryQuery] = useState(''); const [librarySort, setLibrarySort] = useState<LibrarySort>('recent'); const [resourceQuery, setResourceQuery] = useState(''); const [resources, setResources] = useState<Resource[]>([]); const [searching, setSearching] = useState(false); const [selectedBookId, setSelectedBookId] = useState<string | null>(null); const [readerJump, setReaderJump] = useState<BrainNoteLocation | null>(null); const [overlay, setOverlay] = useState<Overlay>(null); const [mobileNavOpen, setMobileNavOpen] = useState(false); const [notice, setNotice] = useState(''); const [tutorPrompt, setTutorPrompt] = useState(''); const [tutorReply, setTutorReply] = useState(''); const [tutorContext, setTutorContext] = useState<ReaderTutorContext | null>(null); const [tutorBusy, setTutorBusy] = useState(false); const [selectionOffer, setSelectionOffer] = useState<SelectionOffer | null>(null); const [noteDraft, setNoteDraft] = useState<NoteDraft>({ title: '', body: '', source: '', kind: 'note' }); const [pathDraft, setPathDraft] = useState({ title: '', description: '' }); const [authUser, setAuthUser] = useState<User | null>(null); const [authName, setAuthName] = useState(''); const [profileFirstName, setProfileFirstName] = useState(() => readProfileName()); const [authEmail, setAuthEmail] = useState(''); const [authPassword, setAuthPassword] = useState(''); const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in'); const [authBusy, setAuthBusy] = useState(false); const [cloudConnections, setCloudConnections] = useState<CloudConnection[]>(() => readCloudConnections()); const [cloudSyncing, setCloudSyncing] = useState(false); const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine); const cloudReady = useRef(false); const fileInput = useRef<HTMLInputElement>(null); const backupInput = useRef<HTMLInputElement>(null)
  const authUserRef = useLatest(authUser)
  const notesRef = useLatest(notes)
  const authUserId = authUser?.id
  const cloudConnection = cloudConnectionForUser(cloudConnections, authUserId)
  const selectedBook = useMemo(() => books.find((book) => book.id === selectedBookId) ?? null, [books, selectedBookId]); const filteredBooks = useMemo(() => { const q = libraryQuery.trim().toLowerCase(); const matches = q ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(q)) : [...books]; return matches.sort((a, b) => librarySort === 'title' ? a.title.localeCompare(b.title) : librarySort === 'progress' ? b.progress - a.progress : b.updated.localeCompare(a.updated)) }, [books, libraryQuery, librarySort]); const overallProgress = books.length ? Math.round(books.reduce((sum, book) => sum + book.progress, 0) / books.length) : 0; const timeGreeting = greetingFor(now); const displayName = displayNameFor(authUser, profileFirstName)
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { const onOnline = () => setOnline(true); const onOffline = () => setOnline(false); window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) } }, [])
  useEffect(() => { consumeCloudOAuthRedirect(); let cancelled = false; void getCurrentSession().then((session) => { if (!cancelled) setAuthUser(session?.user ?? null) }).catch(() => undefined); const unsubscribe = subscribeToAuth((_event, session) => setAuthUser(session?.user ?? null)); return () => { cancelled = true; unsubscribe() } }, [])
  useEffect(() => {
    if (!authUser || isAnonymousUser(authUser)) {
      cloudReady.current = false
      return
    }
    const bound = bindCloudConnectionsToUser(authUser.id)
    setCloudConnections((current) => JSON.stringify(current) === JSON.stringify(bound) ? current : bound)
  }, [authUser, authUserId])
  useEffect(() => {
    const metadata = authUser?.user_metadata as Record<string, unknown> | undefined
    const metadataName = [metadata?.first_name, metadata?.given_name, metadata?.full_name, metadata?.name].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? ''
    setProfileFirstName(readProfileName(authUserId) || firstNameFromValue(metadataName) || (authUser ? '' : readProfileName()))
  }, [authUser, authUserId])
  useEffect(() => { let cancelled = false; const hydrate = async () => { const user = authUserRef.current; const currentNotes = notesRef.current; const value = user && !isAnonymousUser(user) ? await syncPendingNotes(currentNotes) : await hydrateRemoteNotes(currentNotes); if (!cancelled) setNotes(value) }; void hydrate(); return () => { cancelled = true } }, [authUserId, authUserRef, notesRef])
  useEffect(() => {
    const user = authUserRef.current
    const connection = cloudConnection
    if (!user || isAnonymousUser(user) || !connection) { cloudReady.current = false; return }
    let cancelled = false
    const run = async () => {
      setCloudSyncing(true)
      try {
        const merged = await syncCloudState(connection, { books, notes, paths })
        if (cancelled) return
        setBooks((current) => JSON.stringify(current) === JSON.stringify(merged.books) ? current : (writeLibraryBooks(merged.books), merged.books))
        setNotes((current) => JSON.stringify(current) === JSON.stringify(merged.notes) ? current : (writeLocalNotes(merged.notes), merged.notes))
        setPaths((current) => JSON.stringify(current) === JSON.stringify(merged.paths) ? current : (writePaths(merged.paths as LearningPath[]), merged.paths as LearningPath[]))
      } catch (reason) {
        if (!cancelled) showNotice(reason instanceof Error ? reason.message : 'Cloud sync failed. Reconnect the provider and try again.')
      } finally { if (!cancelled) setCloudSyncing(false) }
    }
    if (!cloudReady.current) { cloudReady.current = true; void run(); return () => { cancelled = true } }
    const timer = window.setTimeout(() => void run(), 1400)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [authUserId, authUserRef, cloudConnection, books, notes, paths])
  useEffect(() => { let timer: number | undefined; const update = () => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => { const selection = window.getSelection(); const text = selection?.toString().trim() ?? ''; const node = selection?.anchorNode; const element = node instanceof Element ? node : node?.parentElement; if (!text || text.length < 2 || !element || element.closest('[data-overlay], input, textarea, select, [contenteditable="true"]')) { setSelectionOffer(null); return }; const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null; if (!rect) return; setSelectionOffer({ text: text.slice(0, 20_000), left: Math.min(Math.max(rect.left + rect.width / 2, 110), window.innerWidth - 110), top: rect.bottom + 10 < window.innerHeight - 50 ? rect.bottom + 10 : Math.max(8, rect.top - 52) }) }, 20) }; document.addEventListener('selectionchange', update); document.addEventListener('keyup', update); return () => { if (timer) window.clearTimeout(timer); document.removeEventListener('selectionchange', update); document.removeEventListener('keyup', update) } }, [])
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 3800) }
  function selectNav(label: string) { setMobileNavOpen(false); if (label === 'Second Brain' || label === 'Notes') { setOverlay('brain'); return }; if (label === 'Ask Noema') { setOverlay('noema'); return }; setActiveNav(label); setSelectedBookId(label === 'Read' ? selectedBookId : null) }
  function openNotePanel(seed = '', action: NoteAction = seed ? 'highlight' : 'note', location?: BrainNoteLocation) {
    const labels: Record<NoteAction, { title: string; kind: BrainNoteKind }> = { highlight: { title: 'Saved highlight', kind: 'highlight' }, note: { title: '', kind: 'note' }, question: { title: 'Question', kind: 'question' }, reflect: { title: 'Reflection', kind: 'idea' }, connect: { title: 'Connection', kind: 'connection' } }
    const choice = labels[action]
    const sourceLocation = location ?? (selectedBook ? { bookId: selectedBook.id, bookTitle: selectedBook.title, author: selectedBook.author, chapter: selectedBook.chapter, chapterIndex: selectedBook.chapterIndex, href: selectedBook.currentHref, cfi: selectedBook.cfi } : undefined)
    const source = sourceLocation?.bookTitle ? `${sourceLocation.bookTitle}${sourceLocation.chapter ? ` · ${sourceLocation.chapter}` : ''}${sourceLocation.page ? ` · p. ${sourceLocation.page}` : ''}` : 'Noesis'
    setNoteDraft({ title: choice.title, body: seed, source, kind: choice.kind, location: sourceLocation }); setOverlay('brain')
  }
  function openNoemaPanel(seed = '', context?: ReaderTutorContext) { setTutorPrompt(seed); setTutorContext(context ?? null); setTutorReply(''); setOverlay('noema') }
  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; const isEpub = file.name.toLowerCase().endsWith('.epub'); const isPdf = file.name.toLowerCase().endsWith('.pdf'); if (!isEpub && !isPdf) { showNotice('Noesis imports EPUB and PDF files.'); return }; try { const data = await file.arrayBuffer(); const parsed = isEpub ? await parseEpub(data, file.name) : null; const book = parsed ? epubBookFromParsed(`epub-${crypto.randomUUID()}`, file.name, file.size, parsed) : pdfBookFromSource(`pdf-${crypto.randomUUID()}`, file.name, file.size, file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '), 'Imported PDF'); await saveEpubFile(book.id, data); if (parsed?.text) await saveBookText(book.id, parsed.text); setBooks(upsertLibraryBook(book)); setSelectedBookId(book.id); setActiveNav('Read'); showNotice(`${book.title} was added to your library.`) } catch (reason) { showNotice(friendlyBookError(reason, 'Could not read that file.')) } }
  function updateBookProgress(id: string, progress: number, cfi?: string, href?: string, chapter?: string, chapterIndex?: number, chapterProgress?: number) { setBooks((current) => { const next = current.map((book) => book.id === id ? { ...book, progress, cfi: cfi ?? book.cfi, currentHref: href ?? book.currentHref, chapter: chapter ?? book.chapter, chapterIndex: chapterIndex ?? book.chapterIndex, chapterProgress: chapterProgress ?? book.chapterProgress, updated: new Date().toISOString() } : book); const changed = next.find((book) => book.id === id); if (changed) upsertLibraryBook(changed); return next }) }
  function toggleBookmark(id: string) { setBooks((current) => { const next = current.map((book) => book.id === id ? { ...book, bookmarked: !book.bookmarked, updated: new Date().toISOString() } : book); const changed = next.find((book) => book.id === id); if (changed) upsertLibraryBook(changed); return next }) }
  async function saveNote(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const body = noteDraft.body.trim(); if (body.length < 2) { showNotice('Write a note or highlight first.'); return }; const note: Note = { id: `local-${crypto.randomUUID()}`, kind: noteDraft.kind, title: noteDraft.title.trim() || (noteDraft.kind === 'highlight' ? 'Highlight' : 'Quick note'), body, source: noteDraft.source.trim() || 'Noesis', createdAt: new Date().toISOString(), ...noteDraft.location }; setNotes((current) => [note, ...current]); setNoteDraft({ title: '', body: '', source: '', kind: 'note' }); const destination = await persistNote(note); showNotice(destination === 'remote' ? 'Saved to your Second Brain.' : 'Saved on this device. It will sync when Supabase is available.') }
  async function askNoema(prompt: string, readingContext?: ReaderTutorContext) { const question = prompt.trim(); if (!question) return; const activeContext = readingContext ?? tutorContext; if (readingContext) setTutorContext(readingContext); setTutorPrompt(question); setTutorReply(''); setTutorBusy(true); let bookText = ''; if (selectedBook?.format === 'epub') bookText = await loadBookText(selectedBook.id).catch(() => '') || ''; const contextText = notes.slice(0, 30).map((note) => `${note.title} (${note.source}): ${note.body}`).join('\n\n'); const position = activeContext ? [`Reading position: ${activeContext.chapter ?? 'Current chapter'}${activeContext.page ? ` · page ${activeContext.page}` : ''}`, activeContext.selectedText ? `Selected passage:\n${activeContext.selectedText.slice(0, 8_000)}` : '', activeContext.visibleText ? `Visible reading text:\n${activeContext.visibleText}` : ''].filter(Boolean).join('\n\n') : ''; const additionalBookText = selectedBook?.format === 'epub' && bookText ? `Additional book context:\n${relevantExcerpt(bookText, question, activeContext?.visibleText ? 10_000 : 30_000)}` : ''; const bookContext = selectedBook ? [`Title: ${selectedBook.title}`, `Author: ${selectedBook.author}`, `Current location: ${activeContext?.chapter ?? selectedBook.chapter}`, `Format: ${selectedBook.format}`, activeContext?.bookTitle ? `Reader source: ${activeContext.bookTitle}` : '', position, selectedBook.description ? `Catalog description: ${selectedBook.description}` : '', selectedBook.accessType ? `Access: ${selectedBook.accessType === 'borrow' ? 'borrowed from an external library' : 'public hosted reader'}` : '', selectedBook.sourceName ? `Provider: ${selectedBook.sourceName}` : '', additionalBookText, selectedBook.format === 'web' || selectedBook.format === 'resource' ? 'The full text may be inside a cross-origin or protected reader. Use only supplied notes or pasted passages and do not claim to have read unavailable text.' : ''].filter(Boolean).join('\n') : position; try { const response = await fetch('/api/tutor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, book: bookContext, context: contextText }) }); const result = await response.json() as { ok?: boolean; text?: string; error?: string }; if (!response.ok || !result.ok) throw new Error(result.error || 'Noema could not answer right now.'); setTutorReply(result.text ?? 'Noema returned an empty answer.'); showNotice(activeContext?.visibleText || activeContext?.selectedText ? 'Noema answered from the page you are reading.' : 'Noema answered using your current context.') } catch (reason) { const message = reason instanceof Error ? reason.message : 'Noema could not answer right now.'; setTutorReply(message); showNotice(message) } finally { setTutorBusy(false) } }
  async function searchResources(event?: React.FormEvent) { event?.preventDefault(); const query = resourceQuery.trim(); if (!query) return; setSearching(true); setResources([]); try { const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`); const result = await response.json() as { ok?: boolean; results?: Resource[]; error?: string }; if (!response.ok || !result.ok) throw new Error(result.error || 'Search is unavailable.'); setResources(result.results ?? []); if ((result.results ?? []).length === 0) showNotice('No free resources matched that search.') } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Search is unavailable.') } finally { setSearching(false) } }
  async function addResource(resource: Resource) {
    if (resource.readerUrl) {
      const book: LibraryBook = {
        id: `web-${resource.id}`,
        title: resource.title,
        author: resource.author,
        progress: 0,
        chapter: resource.accessType === 'borrow' ? 'Borrowed from Internet Archive' : 'Internet Archive reader',
        updated: new Date().toISOString(),
        cover: resource.title,
        coverUrl: resource.coverUrl,
        description: resource.description,
        format: 'web',
        sourceUrl: resource.sourceUrl,
        readerUrl: resource.readerUrl,
        sourceName: resource.source,
        accessType: resource.accessType,
      }
      setBooks(upsertLibraryBook(book))
      setSelectedBookId(book.id)
      setActiveNav('Read')
      showNotice(`${resource.title} was added with its official reader.`)
      return
    }
    if (resource.downloadUrl) {
      try {
        const response = await fetch(`/api/resource?url=${encodeURIComponent(resource.downloadUrl)}`)
        if (!response.ok) throw new Error('The source could not be downloaded.')
        const data = await response.arrayBuffer()
        const type = response.headers.get('content-type') || ''
        const isPdf = type.includes('pdf') || resource.downloadUrl.toLowerCase().includes('.pdf')
        const filename = `${resource.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${isPdf ? 'pdf' : 'epub'}`
        const parsed = isPdf ? null : await parseEpub(data, filename)
        const book = parsed
          ? epubBookFromParsed(`epub-${crypto.randomUUID()}`, filename, data.byteLength, parsed)
          : pdfBookFromSource(`pdf-${crypto.randomUUID()}`, filename, data.byteLength, resource.title, resource.author, resource.sourceUrl, resource.coverUrl)
        await saveEpubFile(book.id, data)
        if (parsed?.text) await saveBookText(book.id, parsed.text)
        setBooks(upsertLibraryBook(book))
        setSelectedBookId(book.id)
        setActiveNav('Read')
        showNotice(`${resource.title} was imported into your library.`)
        return
      } catch (reason) {
        showNotice(`${friendlyBookError(reason, 'The download failed.')} You can still open the source page.`)
      }
    }
    const book: LibraryBook = {
      id: `resource-${resource.id}`,
      title: resource.title,
      author: resource.author,
      progress: 0,
      chapter: resource.kind === 'article' ? 'Academic article' : 'External resource',
      updated: new Date().toISOString(),
      cover: resource.title,
      coverUrl: resource.coverUrl,
      description: resource.description,
      format: 'resource',
      sourceUrl: resource.sourceUrl,
      sourceName: resource.source,
    }
    setBooks(upsertLibraryBook(book))
    showNotice(`${resource.title} was saved as a source link.`)
  }
  function openSavedBook(book: LibraryBook) { setReaderJump(null); setSelectedBookId(book.id); setActiveNav('Read') }
  function openNoteLocation(note: Note) {
    const book = note.bookId ? books.find((item) => item.id === note.bookId) : books.find((item) => note.bookTitle && item.title === note.bookTitle)
    if (!book) { showNotice('The original book is not on this device.'); return }
    setReaderJump({ bookId: book.id, bookTitle: book.title, author: book.author, chapter: note.chapter, chapterIndex: note.chapterIndex, page: note.page, href: note.href, cfi: note.cfi })
    setSelectedBookId(book.id); setActiveNav('Read'); setOverlay(null)
  }
  function createPath(event: React.FormEvent) { event.preventDefault(); if (!pathDraft.title.trim()) return; const path: LearningPath = { id: `path-${crypto.randomUUID()}`, title: pathDraft.title.trim(), description: pathDraft.description.trim() || 'A personal collection for focused study.', bookIds: [], createdAt: new Date().toISOString() }; const next = [path, ...paths]; setPaths(next); writePaths(next); setPathDraft({ title: '', description: '' }); showNotice('Learning path created.') }
  function deleteBook(book: LibraryBook) { if (!window.confirm(`Remove ${book.title} from your library?`)) return; setBooks(removeLibraryBook(book.id)); if (selectedBookId === book.id) setSelectedBookId(null); showNotice(`${book.title} was removed.`) }
  async function restorePayload(payload: Awaited<ReturnType<typeof restoreBackup>>) { setBooks(payload.books); setNotes(payload.notes); const restoredPaths = payload.paths as LearningPath[]; setPaths(restoredPaths); writeLocalNotes(payload.notes); writeLibraryBooks(payload.books); writePaths(restoredPaths); showNotice(`Restored ${payload.books.length} books and ${payload.notes.length} notes.`) }
  async function handleBackupImport(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { await restorePayload(await restoreBackup(file)) } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Could not restore that backup.') } }
  async function connectCloud(id: CloudProviderId) { if (!authUser || isAnonymousUser(authUser)) { showNotice('Sign in to Noesis before connecting a personal cloud provider.'); setActiveNav('Account'); return }; try { await connectCloudProvider(id, authUser.id); setCloudConnections(readCloudConnections()); showNotice('Cloud provider connected. Noesis will sync your library automatically.') } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Cloud connection failed.') } }
  function disconnectCloud(id: CloudProviderId) { setCloudConnections(disconnectCloudProvider(id)); cloudReady.current = false; showNotice('Cloud provider disconnected. Your local library is unchanged.') }
  async function syncNow() { const connection = cloudConnection; if (!connection) { showNotice('Sign in and connect the same provider to sync your books.'); return }; setCloudSyncing(true); try { const merged = await syncCloudState(connection, { books, notes, paths }); setBooks(merged.books); setNotes(merged.notes); setPaths(merged.paths as LearningPath[]); writeLibraryBooks(merged.books); writeLocalNotes(merged.notes); writePaths(merged.paths as LearningPath[]); showNotice('Cloud sync completed.') } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Cloud sync failed.') } finally { setCloudSyncing(false) } }
  async function handleAuth(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const email = authEmail.trim(); if (!email || authPassword.length < 6) { showNotice('Enter an email and a password with at least six characters.'); return }; setAuthBusy(true); try { if (authMode === 'sign-up' && isAnonymousUser(authUser)) { const session = await upgradeAnonymousAccount(email, authPassword, authName); setAuthUser(session?.user ?? authUser); showNotice('Your account is ready. Your current notes stay connected to it.') } else if (authMode === 'sign-up') { const result = await signUpWithPassword(email, authPassword, authName); setAuthUser(result.user); showNotice(result.session ? 'Account created and signed in.' : 'Account created. Check your email to confirm it.') } else { const session = await signInWithPassword(email, authPassword); setAuthUser(session.user); showNotice('Signed in. Your notes and backup are connected.') }; setAuthPassword('') } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Authentication failed.') } finally { setAuthBusy(false) } }
  async function saveFirstName(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const value = profileFirstName.trim(); writeProfileName(value, authUserId); if (authUser && !isAnonymousUser(authUser)) { try { setAuthUser(await updateProfileName(value)) } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Your first name could not be saved.'); return } } setProfileFirstName(value); showNotice(value ? 'Your first name was saved.' : 'Your first name was cleared.') }
  async function handleResetPassword() { const email = authEmail.trim(); if (!email) { showNotice('Enter your email first, then choose password reset.'); return }; try { await sendPasswordReset(email); showNotice('Password reset instructions sent.') } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Could not send password reset instructions.') } }
  async function handleSignOut() { try { await signOut(); setAuthUser(null); showNotice('Signed out. Your local library and provider connection remain on this device.') } catch (reason) { showNotice(reason instanceof Error ? reason.message : 'Could not sign out.') } }
  function homePage() {
    const current = books.find((book) => book.progress > 0 && book.progress < 100) ?? books[0]
    return <div className="reading-home"><section className="home-reading-hero"><div className="home-hero-content"><p className="eyebrow">Your reading space</p><h2>{timeGreeting}{displayName ? `, ${displayName}.` : '.'}</h2><p>Pick up where you left off, or choose your next read.</p>{current ? <div className="hero-continue"><div className="continue-cover-wrap"><BookCover book={current} /></div><div className="continue-details"><p className="eyebrow">Continue reading</p><h2>{current.title}</h2><p className="muted">{current.author}</p><p className="chapter-line"><BookOpen size={14} /> {current.chapter || 'Opening chapter'}</p><div className="progress-row"><div className="progress-track"><span style={{ width: `${current.progress}%` }} /></div><strong>{Math.round(current.progress)}%</strong></div><div className="hero-continue-actions"><button className="primary-button" onClick={() => openSavedBook(current)}>Continue reading <ArrowRight size={16} /></button><button className="icon-button" onClick={() => openNotePanel('', 'note')} aria-label="Add a note"><MoreVertical size={16} /></button></div></div></div> : <button className="hero-empty-reading" onClick={() => fileInput.current?.click()}><Plus size={18} /> Add your first book</button>}</div><div className="home-hero-mark"><NoesisMark size={34} /><span>NOESIS</span><small>by Proairetos</small></div></section><ReadingShelfSection books={filteredBooks.slice(0, 6)} onOpen={openSavedBook} onImport={() => fileInput.current?.click()} /><PathSection paths={paths} books={books} onOpen={() => selectNav('Learning Paths')} /><NotesSection notes={notes} onOpen={() => setOverlay('brain')} onOpenNote={openNoteLocation} /><SuggestedSection resources={resources} onExplore={() => selectNav('Explore')} /></div>
  }
  function readPage() { return <Page title="Read" subtitle=""><section className="reader-landing panel-card"><BookOpen size={22} /><strong>{books.length ? 'Choose a title' : 'Your reader is empty'}</strong><button className="primary-button" onClick={() => fileInput.current?.click()}><Upload size={14} /> Add book</button></section><BookSection books={books} onOpen={openSavedBook} /></Page> }
  function libraryPage() { return <Page title="My library" subtitle={`${books.length} ${books.length === 1 ? 'title' : 'titles'} saved on this device.`}><div className="page-toolbar"><div className="field-with-icon"><Search size={15} /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search your library" /></div><div className="page-toolbar-actions"><select className="library-sort" value={librarySort} onChange={(event) => setLibrarySort(event.target.value as LibrarySort)} aria-label="Sort library"><option value="recent">Recently added</option><option value="title">Title</option><option value="progress">Progress</option></select><button className="primary-button" onClick={() => fileInput.current?.click()}><Upload size={15} /> Add a book</button></div></div><BookSection books={filteredBooks} onOpen={openSavedBook} onImport={() => fileInput.current?.click()} onDelete={deleteBook} /></Page> }
  function pathsPage() { return <Page title="Learning paths" subtitle="Group books around a question, skill, or long-term goal."><form className="create-form panel-card" onSubmit={createPath}><input value={pathDraft.title} onChange={(event) => setPathDraft({ ...pathDraft, title: event.target.value })} placeholder="Path name, e.g. Cognitive psychology" /><input value={pathDraft.description} onChange={(event) => setPathDraft({ ...pathDraft, description: event.target.value })} placeholder="What do you want this path to help you understand?" /><button className="primary-button" type="submit"><Plus size={15} /> Create path</button></form><PathSection paths={paths} books={books} editable onDelete={(id) => { const next = paths.filter((path) => path.id !== id); setPaths(next); writePaths(next) }} onAssign={(pathId, bookId) => { const next = paths.map((path) => path.id === pathId && bookId && !path.bookIds.includes(bookId) ? { ...path, bookIds: [...path.bookIds, bookId] } : path); setPaths(next); writePaths(next) }} /></Page> }
  function notesPage() { return <Page title="Notes" subtitle="Your highlights, questions, and ideas in one place."><NotesSection notes={notes} expanded onOpen={openNotePanel} onOpenNote={openNoteLocation} /></Page> }
  function progressPage() { const readCount = books.filter((book) => book.progress > 0).length; return <Page title="Progress" subtitle="A clear view of the reading you have actually done."><div className="metric-grid"><Metric label="Overall progress" value={`${overallProgress}%`} detail="Across your library" /><Metric label="Books started" value={`${readCount}`} detail={`of ${books.length} saved titles`} /><Metric label="Notes saved" value={`${notes.length}`} detail="In your Second Brain" /><Metric label="Learning paths" value={`${paths.length}`} detail="Created by you" /></div><div className="progress-list panel-card"><h3>Reading progress</h3>{books.length === 0 ? <div className="empty-state">Add a book or save a reading source to track progress here.</div> : books.map((book) => <div className="progress-book" key={book.id}><BookCover book={book} compact /><div><strong>{book.title}</strong><span>{book.author}</span><div className="progress-track"><span style={{ width: `${book.progress}%` }} /></div></div><b>{Math.round(book.progress)}%</b></div>)}</div></Page> }
  function explorePage() { const localMatches = resourceQuery.trim() ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(resourceQuery.toLowerCase())) : []; return <Page title="Explore" subtitle="Search books, open-access articles, journals, and academic papers."><form className="explore-search panel-card" onSubmit={searchResources}><Search size={18} /><input value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="What do you want to learn?" /><button className="primary-button" type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>{localMatches.length > 0 ? <section className="resource-section"><div className="section-heading"><div><h2>In your library</h2><p>Books and documents already saved here.</p></div></div><BookSection books={localMatches} onOpen={openSavedBook} /></section> : null}<section className="resource-section"><div className="section-heading"><div><h2>Books and research</h2><p>Project Gutenberg, Open Library, OpenAlex, and Internet Archive. Import files or read official source pages inside Noesis.</p></div></div>{resources.length === 0 && !searching ? <div className="empty-state">Search for a topic, author, journal, or research question.</div> : <div className="resource-grid">{resources.map((resource) => <article className="resource-card panel-card" key={`${resource.source}-${resource.id}`}><div className="resource-cover">{resource.coverUrl ? <img src={resource.coverUrl} alt="" /> : resource.kind === 'article' ? <FileText size={22} /> : <BookOpen size={22} />}</div><div><span className="resource-source">{resource.source} · {resource.format}</span><h3>{resource.title}</h3><p>{resource.author}{resource.year ? ` · ${resource.year}` : ''}</p><div className="resource-actions"><button className="secondary-button" onClick={() => window.open(resource.sourceUrl, '_blank', 'noopener,noreferrer')}>Open source</button><button className="primary-button" onClick={() => void addResource(resource)}><Plus size={14} /> {resource.readerUrl ? 'Read in Noesis' : resource.downloadUrl ? 'Import' : 'Save link'}</button></div></div></article>)}</div>}</section></Page> }
  function backupPage() {
    const signedIn = Boolean(authUser && !isAnonymousUser(authUser))
    return <Page title="Cloud backup" subtitle="Keep your library synced across devices with storage you control.">
      <section className="profile-settings panel-card"><div><p className="eyebrow">Personalize Noesis</p><h3>Your greeting</h3><p>Set the first name Noesis should use on the home page. Leave it blank to use your account name or the first part of your email.</p></div><form className="profile-name-form" onSubmit={saveFirstName}><label>First name<input value={profileFirstName} onChange={(event) => setProfileFirstName(event.target.value)} placeholder="e.g. David" autoComplete="given-name" /></label><button className="primary-button" type="submit">Save name</button></form></section>
      <section className="backup-hero panel-card"><div className="backup-icon"><Cloud size={24} /></div><div><h3>Live cloud sync</h3><p>Noesis syncs your library manifest, notes, paths, and each local EPUB as separate files. When you sign in on another device and connect the same provider, your reading data and books are restored without a ZIP archive.</p><small>{!online ? 'You are offline. Changes will stay on this device until you reconnect.' : !signedIn ? 'Sign in from Account before connecting a personal cloud provider.' : cloudSyncing ? 'Syncing your latest changes…' : cloudConnections.length ? 'Connected and syncing automatically.' : 'Connect one provider below to begin.'}</small></div></section>
      <section className="cloud-provider-grid">{listCloudProviders().map((provider) => { const connection = signedIn ? cloudConnectionForUser(cloudConnections.filter((item) => item.provider === provider.id), authUser?.id) : undefined; const expired = Boolean(connection && connection.expiresAt <= Date.now() + 30_000); return <article className="cloud-provider-card panel-card" key={provider.id}><div className="cloud-provider-head"><div className="backup-icon"><Cloud size={18} /></div><div><h3>{provider.label}</h3><p>{provider.description}</p></div><span className={connection && !expired ? 'cloud-status cloud-status-connected' : 'cloud-status'}>{connection ? expired ? 'Reconnect' : 'Connected' : provider.configured ? 'Ready' : 'Setup needed'}</span></div>{connection && !expired ? <div className="cloud-provider-actions"><button className="secondary-button" onClick={() => void syncNow()} disabled={cloudSyncing || !online}><RotateCcw size={14} /> {cloudSyncing ? 'Syncing…' : 'Sync now'}</button><button className="secondary-button" onClick={() => disconnectCloud(provider.id)}>Disconnect</button></div> : <div className="cloud-provider-actions"><button className="primary-button" onClick={() => void connectCloud(provider.id)} disabled={!signedIn || !provider.configured || !online}><Cloud size={14} /> {expired ? 'Reconnect' : 'Connect'} {provider.label}</button><a className="cloud-setup-link" href={provider.setupUrl} target="_blank" rel="noreferrer">Provider setup</a></div>}{!provider.configured ? <p className="cloud-provider-note">Add the provider client ID/app key as a Cloudflare build variable, then redeploy.</p> : null}</article> })}</section>
      <div className="backup-actions"><button className="secondary-button" onClick={() => void downloadBackupFile(books, notes, paths)}><Download size={15} /> Export a local ZIP</button><button className="secondary-button" onClick={() => backupInput.current?.click()}><Upload size={15} /> Restore a local export</button></div>
      <div className="backup-note panel-card"><strong>How another device gets your EPUBs</strong><p>Sign in to the same Noesis account, connect the same provider, and Noesis downloads the separate EPUB files and metadata into that device’s local reader. A provider connection is per device by design; Noesis never stores your provider password.</p></div>
    </Page>
  }
  function accountPage() { const anonymous = isAnonymousUser(authUser); return <Page title="Account" subtitle="Use one account to keep notes and backups connected.">{authUser && !anonymous ? <section className="account-signed panel-card"><div className="account-avatar"><UserRound size={22} /></div><div><span className="eyebrow">Signed in</span><h3>{displayName || authUser.email}</h3><p>{authUser.email} · Your Second Brain and cloud backup use this account.</p></div><button className="secondary-button" onClick={() => void handleSignOut()}>Sign out</button></section> : <form className="auth-form panel-card" onSubmit={handleAuth}><div className="auth-tabs"><button type="button" className={authMode === 'sign-in' ? 'auth-tab-active' : ''} onClick={() => setAuthMode('sign-in')}>Sign in</button><button type="button" className={authMode === 'sign-up' ? 'auth-tab-active' : ''} onClick={() => setAuthMode('sign-up')}>Create account</button></div>{anonymous ? <div className="auth-callout"><Sparkles size={15} /> Create an account to preserve this anonymous session’s notes and use the same library on another device.</div> : null}{authMode === 'sign-up' ? <label>Name<input autoComplete="name" value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="Your name" /></label> : null}<label>Email<input type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" /></label><label>Password<input type="password" autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="At least 6 characters" /></label><button className="primary-button" type="submit" disabled={authBusy}>{authBusy ? 'Working…' : authMode === 'sign-in' ? 'Sign in' : anonymous ? 'Save this account' : 'Create account'}</button>{authMode === 'sign-in' ? <button type="button" className="text-button auth-reset" onClick={() => void handleResetPassword()}>Forgot password?</button> : null}<p className="auth-footnote">Your library stays available locally. Sign in when you want notes and cloud sync on another device.</p></form>}</Page> }
  const page = selectedBook && activeNav === 'Read' ? <Reader book={selectedBook} notes={notes} onClose={() => { setSelectedBookId(null); setReaderJump(null); setActiveNav('My Library') }} onProgress={(progress, cfi, href, chapter, chapterIndex, chapterProgress) => updateBookProgress(selectedBook.id, progress, cfi, href, chapter, chapterIndex, chapterProgress)} onNote={openNotePanel} onOpenNote={openNoteLocation} onAsk={openNoemaPanel} onBookmark={() => toggleBookmark(selectedBook.id)} initialLocation={readerJump} /> : activeNav === 'Home' ? homePage() : activeNav === 'My Library' ? libraryPage() : activeNav === 'Learning Paths' ? pathsPage() : activeNav === 'Read' ? readPage() : activeNav === 'Notes' ? notesPage() : activeNav === 'Progress' ? progressPage() : activeNav === 'Explore' ? explorePage() : activeNav === 'Cloud Backup' ? backupPage() : activeNav === 'Account' ? accountPage() : <div className="empty-state">Choose a page from the navigation.</div>
  return <div className="app-shell"><div className="ambient ambient-top" /><div className="ambient ambient-bottom" /><aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}><div className="sidebar-image" aria-hidden="true" /><div className="sidebar-content"><div className="brand-row"><div className="brand-mark"><NoesisMark size={22} /></div><div><strong>NOESIS</strong><span>by Proairetos</span></div><button className="icon-button sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button></div><nav className="main-nav" aria-label="Main navigation">{navItems.map(({ label, text, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? 'nav-item-active' : ''}`} onClick={() => selectNav(label)} title={text}><Icon size={17} /><span>{text}</span></button>)}</nav><div className="sidebar-bottom"><div className="sidebar-search"><Search size={16} /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search your library" aria-label="Search your library" /></div><div className="quick-icon-row"><button className="quick-icon" onClick={() => openNotePanel()} aria-label="Open Second Brain" title="Second Brain"><Brain size={16} /></button><button className="quick-icon" onClick={() => fileInput.current?.click()} aria-label="Add EPUB or PDF" title="Add book"><Plus size={16} /></button><button className="quick-icon" onClick={() => selectNav('Learning Paths')} aria-label="Create learning path" title="Create path"><ListChecks size={16} /></button></div></div></div></aside>{mobileNavOpen ? <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" /> : null}<main className="main-column"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="greeting"><p className="eyebrow">{navItems.find((item) => item.label === activeNav)?.text ?? activeNav}</p><h1>{activeNav === 'Home' ? 'Noesis' : navItems.find((item) => item.label === activeNav)?.text ?? activeNav}</h1></div><button className="icon-button compact-tool-button" onClick={() => setOverlay('brain')} aria-label="Open Second Brain" title="Second Brain"><Brain size={17} /></button><button className="icon-button compact-tool-button" onClick={() => openNoemaPanel()} aria-label="Ask Noema" title="Ask Noema"><Sparkles size={17} /></button><button className="account-top-button" onClick={() => selectNav('Account')} aria-label="Open account">{displayName?.slice(0, 1).toUpperCase() || <UserRound size={16} />}</button></header><div className="page-content">{page}</div><nav className="mobile-bottom-nav" aria-label="Mobile navigation"><button className={activeNav === 'Home' ? 'mobile-bottom-active' : ''} onClick={() => selectNav('Home')}><Home size={17} /><span>Home</span></button><button className={activeNav === 'My Library' ? 'mobile-bottom-active' : ''} onClick={() => selectNav('My Library')}><Library size={17} /><span>Library</span></button><button className={activeNav === 'Learning Paths' ? 'mobile-bottom-active' : ''} onClick={() => selectNav('Learning Paths')}><ListChecks size={17} /><span>Paths</span></button><button className={activeNav === 'Notes' ? 'mobile-bottom-active' : ''} onClick={() => selectNav('Notes')}><FileText size={17} /><span>Second Brain</span></button><button onClick={() => openNoemaPanel()}><Sparkles size={17} /><span>Noema</span></button></nav><input ref={fileInput} className="visually-hidden" type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={handleImport} /><input ref={backupInput} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={handleBackupImport} />{selectionOffer && !overlay ? <div className="selection-action" style={{ top: selectionOffer.top, left: selectionOffer.left }} onMouseDown={(event) => event.preventDefault()}><button onClick={() => { openNotePanel(selectionOffer.text, 'highlight'); setSelectionOffer(null) }}><Highlighter size={14} /> Highlight</button><button onClick={() => { openNotePanel(selectionOffer.text, 'note'); setSelectionOffer(null) }}><FileText size={14} /> Note</button><button onClick={() => { openNotePanel(selectionOffer.text, 'question'); setSelectionOffer(null) }}><MessageCircleQuestion size={14} /> Question</button><button onClick={() => { openNotePanel(selectionOffer.text, 'reflect'); setSelectionOffer(null) }}><Lightbulb size={14} /> Reflect</button><button onClick={() => { openNotePanel(selectionOffer.text, 'connect'); setSelectionOffer(null) }}><Link2 size={14} /> Connect</button></div> : null}{overlay === 'brain' ? <BrainOverlay notes={notes} draft={noteDraft} setDraft={setNoteDraft} onClose={() => setOverlay(null)} onSave={saveNote} onOpenNote={openNoteLocation} /> : null}{overlay === 'noema' ? <NoemaOverlay context={tutorContext} prompt={tutorPrompt} reply={tutorReply} busy={tutorBusy} setPrompt={setTutorPrompt} onAsk={askNoema} onClose={() => setOverlay(null)} /> : null}{notice ? <div className="toast-notice"><Sparkles size={15} /> {notice}</div> : null}</main>{activeNav !== 'Read' ? <DesktopContextSidebar now={now} notes={notes} onOpenNotes={() => setOverlay('brain')} /> : null}</div>
}

function DesktopContextSidebar({ now, notes, onOpenNotes }: { now: Date; notes: Note[]; onOpenNotes: () => void }) {
  const [focusItems, setFocusItems] = useState([false, false, false, false])
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)
  const highlights = notes.filter((note) => note.kind === 'highlight').slice(0, 3)
  const questions = notes.filter((note) => note.kind === 'question').length
  const reflections = notes.filter((note) => note.kind === 'idea' || note.kind === 'connection').length
  const focusLabels = ['Read for 30 minutes', 'Capture 2 key ideas', 'Reflect on one chapter', 'Make one connection']
  return <aside className="desktop-context-sidebar" aria-label="Daily reading context">
    <div className="context-date-row"><span><CalendarDays size={12} /> {dateLabel}</span><span><CloudSun size={14} /> 56°</span></div>
    <section className="context-section context-focus"><div className="context-section-heading"><h2>Today’s focus</h2><MoreVertical size={14} /></div><p className="context-intro">Make reading part of the day, one quiet session at a time.</p><div className="focus-list">{focusLabels.map((label, index) => <button key={label} className={focusItems[index] ? 'focus-item focus-item-done' : 'focus-item'} onClick={() => setFocusItems((items) => items.map((done, itemIndex) => itemIndex === index ? !done : done))}>{focusItems[index] ? <CheckCircle2 size={14} /> : <Circle size={14} />}<span>{label}</span></button>)}</div></section>
    <section className="context-section"><div className="context-section-heading"><h2>Recent highlights</h2><button onClick={onOpenNotes}>View all <ArrowRight size={12} /></button></div>{highlights.length > 0 ? <div className="context-highlight-list">{highlights.map((note) => <article key={note.id}><Highlighter size={12} /><div><p>{note.body}</p><small>{note.source}</small></div></article>)}</div> : <p className="context-empty">Highlights from your reading will appear here.</p>}</section>
    <section className="context-section context-brain"><div className="context-section-heading"><h2>Your Second Brain</h2><button onClick={onOpenNotes}>Open <ArrowRight size={12} /></button></div><p className="context-intro">Your highlights, notes, and connections in one place.</p><div className="context-metrics"><div><strong>{notes.length}</strong><span>Notes</span></div><div><strong>{highlights.length}</strong><span>Highlights</span></div><div><strong>{questions + reflections}</strong><span>Ideas</span></div></div>{notes[0] ? <div className="context-quote"><QuoteMark /><p>“{notes[0].body.slice(0, 96)}{notes[0].body.length > 96 ? '…' : ''}”</p><small>{notes[0].source}</small></div> : null}</section>
  </aside>
}
function QuoteMark() { return <span className="context-quote-mark" aria-hidden="true">“</span> }
function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <div className="page-view"><div className="page-heading"><div><p className="eyebrow">Noesis</p><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>{children}</div> }
function SuggestedSection({ resources, onExplore }: { resources: Resource[]; onExplore: () => void }) { return <section className="section-block suggested-section"><div className="section-heading"><div><h2>Suggested for you</h2><p>{resources.length ? 'Based on your latest search.' : 'Search books, journals, and research for your next idea.'}</p></div><button className="text-button" onClick={onExplore}>Explore <ArrowRight size={15} /></button></div>{resources.length === 0 ? <button className="suggested-empty panel-card" onClick={onExplore}><Search size={18} /><span>Find a book, article, or journal</span><ArrowRight size={16} /></button> : <div className="suggested-grid">{resources.slice(0, 5).map((resource) => <button className="suggested-card" key={`${resource.source}-${resource.id}`} onClick={onExplore}><div className="suggested-cover">{resource.coverUrl ? <img src={resource.coverUrl} alt="" /> : resource.kind === 'article' ? <FileText size={19} /> : <BookOpen size={19} />}</div><strong>{resource.title}</strong><span>{resource.author}</span></button>)}</div>}</section> }
function BookSection({ books, onOpen, onImport, onDelete }: { books: LibraryBook[]; onOpen: (book: LibraryBook) => void; onImport?: () => void; onDelete?: (book: LibraryBook) => void }) { return <section className="section-block library-section"><div className="section-heading"><div><h2>My library</h2><p>Local books, articles, and reading sources.</p></div>{onImport ? <button className="text-button" onClick={onImport}>Import <Upload size={14} /></button> : null}</div>{books.length === 0 ? <div className="empty-state">No books here yet. Import an EPUB or search Explore for a free resource.</div> : <div className="book-grid">{books.map((book) => <div className="book-card-wrap" key={book.id}><button className="book-card" onClick={() => onOpen(book)}><div className="book-card-cover"><BookCover book={book} compact /><ProgressRing value={book.progress} />{book.accessType === 'borrow' ? <span className="book-card-badge">Borrowed</span> : book.format === 'resource' ? <span className="book-card-badge">Source</span> : null}</div><div className="book-card-title">{book.title}</div><div className="book-card-author">{book.author}</div></button>{onDelete ? <button className="book-delete" onClick={() => onDelete(book)} aria-label={`Remove ${book.title}`}><Trash2 size={13} /></button> : null}</div>)}</div>}</section> }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric-card panel-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article> }
function ReadingShelfSection({ books, onOpen, onImport }: { books: LibraryBook[]; onOpen: (book: LibraryBook) => void; onImport: () => void }) { return <section className="section-block shelf-section"><div className="section-heading"><div><h2>Recently reading</h2><p>A quiet shelf for the books you are spending time with.</p></div><button className="text-button" onClick={onImport}>Add book <Plus size={14} /></button></div>{books.length === 0 ? <button className="empty-state" onClick={onImport}>Your shelf is waiting for its first book.</button> : <div className="bookshelf-row">{books.map((book) => <button className="shelf-book" key={book.id} onClick={() => onOpen(book)}><div className="shelf-cover"><BookCover book={book} compact /><span className="shelf-progress" style={{ width: `${Math.max(4, book.progress)}%` }} /></div><strong>{book.title}</strong><span>{book.author}</span><small>{Math.round(book.progress)}% read</small></button>)}</div>}</section> }
function PathSection({ paths, books, onOpen, editable = false, onDelete, onAssign }: { paths: LearningPath[]; books: LibraryBook[]; onOpen?: () => void; editable?: boolean; onDelete?: (id: string) => void; onAssign?: (pathId: string, bookId: string) => void }) { return <section className="section-block path-section"><div className="section-heading"><div><h2>Learning paths</h2><p>Journeys that connect books around one question or goal.</p></div>{onOpen ? <button className="text-button" onClick={onOpen}>View all <ArrowRight size={15} /></button> : null}</div>{paths.length === 0 ? <div className="empty-state">Create a path when you want to connect several books around one goal.</div> : <div className="journey-list">{paths.map((path) => { const pathBooks = books.filter((book) => path.bookIds.includes(book.id)); const progress = pathBooks.length ? Math.round(pathBooks.reduce((sum, book) => sum + book.progress, 0) / pathBooks.length) : 0; return <article className="journey-item" key={path.id}><div className="journey-marker"><Brain size={15} /></div><div className="journey-content"><div className="journey-line"><strong>{path.title}</strong><span>{progress}%</span></div><div className="journey-track"><span style={{ width: `${progress}%` }} /></div><p>{path.description}</p><small>{pathBooks.length} {pathBooks.length === 1 ? 'book' : 'books'} · {progress >= 100 ? 'Complete' : 'In progress'}</small>{editable && books.length > 0 ? <select className="path-book-select" defaultValue="" onChange={(event) => { if (event.target.value) onAssign?.(path.id, event.target.value); event.target.value = '' }}><option value="">Add a book…</option>{books.filter((book) => !path.bookIds.includes(book.id)).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select> : null}</div>{editable ? <button className="path-delete" onClick={() => onDelete?.(path.id)} aria-label={`Delete ${path.title}`}><Trash2 size={14} /></button> : null}</article> })}</div>}</section> }
function NotesSection({ notes, expanded = false, onOpen, onOpenNote }: { notes: Note[]; expanded?: boolean; onOpen: (seed?: string) => void; onOpenNote?: (note: Note) => void }) { return <section className="section-block notes-section"><div className="section-heading"><div><h2>My notes</h2><p>Highlights and ideas worth returning to.</p></div><button className="text-button" onClick={() => onOpen()}>Add note <Plus size={14} /></button></div>{notes.length === 0 ? <div className="empty-state">Select text anywhere or add a note to start your Second Brain.</div> : <div className="notes-grid">{notes.slice(0, expanded ? 100 : 6).map((note) => <article key={note.id} className={`note-card note-${note.kind}`}><div className="note-icon">{note.kind === 'highlight' ? <Highlighter size={16} /> : note.kind === 'idea' ? <Sparkles size={16} /> : note.kind === 'connection' ? <Link2 size={16} /> : <CircleHelp size={16} />}</div><p>{note.body}</p><span>{note.bookTitle ? `${note.bookTitle}${note.chapter ? ` · ${note.chapter}` : ''}${note.page ? ` · p. ${note.page}` : ''}` : note.source}</span><div className="note-footer"><em>{note.title}</em><button className="icon-button tiny" onClick={() => note.bookId && onOpenNote ? onOpenNote(note) : onOpen(note.body)} aria-label={note.bookId ? 'Open in book' : 'Open note'}>{note.bookId ? <BookOpen size={15} /> : <MoreVertical size={15} />}</button></div></article>)}</div>}</section> }
function BrainOverlay({ notes, draft, setDraft, onClose, onSave, onOpenNote }: { notes: Note[]; draft: NoteDraft; setDraft: React.Dispatch<React.SetStateAction<NoteDraft>>; onClose: () => void; onSave: (event: React.FormEvent<HTMLFormElement>) => void; onOpenNote: (note: Note) => void }) {
  const [filter, setFilter] = useState<'all' | BrainNoteKind>('all')
  const labels: Array<{ id: 'all' | BrainNoteKind; label: string }> = [{ id: 'all', label: 'All' }, { id: 'highlight', label: 'Highlights' }, { id: 'note', label: 'Notes' }, { id: 'idea', label: 'Ideas' }, { id: 'question', label: 'Questions' }, { id: 'connection', label: 'Connections' }]
  const filtered = filter === 'all' ? notes : notes.filter((note) => note.kind === filter)
  return <div className="brain-backdrop" data-overlay onMouseDown={onClose}><section className="brain-panel" onMouseDown={(event) => event.stopPropagation()}><div className="brain-panel-head"><div><p className="eyebrow">Second Brain</p><h2>Keep what matters</h2><p>Separate highlights, notes, ideas, and questions without losing their source.</p></div><button className="icon-button" onClick={onClose} aria-label="Close Second Brain"><X size={18} /></button></div><form className="brain-form" onSubmit={onSave}><label>Capture as<select value={draft.kind} onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value as BrainNoteKind }))}><option value="highlight">Highlight</option><option value="note">Note</option><option value="question">Question</option><option value="idea">Reflection</option><option value="connection">Connection</option></select></label><label>Title<input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Quick note" /></label><label>Note<textarea value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} placeholder="Write an idea, question, or highlighted passage…" rows={5} /></label><label>{draft.location?.bookId ? 'Detected source' : 'Source'}<input value={draft.source} onChange={(event) => setDraft((value) => ({ ...value, source: event.target.value }))} placeholder="Book, chapter, or link" readOnly={Boolean(draft.location?.bookId)} /></label>{draft.location?.bookId ? <p className="brain-source-hint">This location is captured automatically from the open reader. Clicking the saved item will return here.</p> : null}<button className="primary-button" type="submit"><Plus size={16} /> Save to Second Brain</button></form><div className="brain-list"><div className="brain-list-heading"><h3>Knowledge shelf</h3><span>{filtered.length}</span></div><div className="brain-filter-row" role="tablist" aria-label="Second Brain sections">{labels.map((item) => <button key={item.id} className={filter === item.id ? 'brain-filter-active' : ''} onClick={() => setFilter(item.id)} role="tab" aria-selected={filter === item.id}>{item.label}</button>)}</div>{filtered.length > 0 ? filtered.slice(0, 40).map((note) => <article className="brain-list-item" key={note.id}><div><strong>{note.title}</strong><p>{note.body}</p><small>{note.bookTitle ? `${note.bookTitle}${note.chapter ? ` · ${note.chapter}` : ''}${note.page ? ` · p. ${note.page}` : ''}` : note.source}</small><div className="brain-list-actions">{note.bookId ? <button className="brain-open-note" onClick={() => onOpenNote(note)}><BookOpen size={11} /> Open in book</button> : null}<span className={note.synced ? 'sync-state synced' : 'sync-state'}>{note.synced ? 'Synced' : 'Local'}</span></div></div></article>) : <p className="brain-rail-empty">Nothing saved in this section yet.</p>}</div></section></div>
}
function NoemaOverlay({ context, prompt, reply, busy, setPrompt, onAsk, onClose }: { context: ReaderTutorContext | null; prompt: string; reply: string; busy: boolean; setPrompt: (value: string) => void; onAsk: TutorHandler; onClose: () => void }) {
  const location = context ? [context.chapter, context.page ? `p. ${context.page}` : ''].filter(Boolean).join(' · ') : ''
  const hasPassage = Boolean(context?.selectedText || context?.visibleText)
  const explainPrompt = context?.selectedText ? 'Explain the selected passage' : 'Explain the current page'
  return <div className="brain-backdrop" data-overlay onMouseDown={onClose}><section className="noema-panel" onMouseDown={(event) => event.stopPropagation()}><div className="brain-panel-head"><div><p className="eyebrow">Noema</p><h2>Your learning guide</h2><p>{hasPassage ? 'This conversation is grounded in the passage you are reading.' : 'Ask about your book or notes. Paste a borrowed passage when you need a precise explanation.'}</p></div><button className="icon-button" onClick={onClose} aria-label="Close Noema"><X size={18} /></button></div>{context ? <div className="noema-reader-context"><BookOpen size={15} /><span><strong>{hasPassage ? 'Reading context' : 'Book context'}</strong><small>{context.bookTitle}{location ? ` · ${location}` : ''}</small></span></div> : null}<div className="noema-orb"><Sparkles size={24} /></div><div className="tutor-chips"><button onClick={() => onAsk(explainPrompt)}>{context?.selectedText ? 'Explain this passage' : context?.visibleText ? 'Explain this page' : 'Explain this book'}</button><button onClick={() => onAsk('Summarize the ideas on this page')}>Summarize this page</button><button onClick={() => onAsk('Test my understanding of what I am reading')}>Test my understanding</button><button onClick={() => onAsk('Connect this passage to my saved notes')}>Connect to my notes</button></div><div className="noema-input"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onAsk(prompt) } }} placeholder="Ask about the page, passage, or book…" rows={3} /><button className="primary-button" onClick={() => onAsk(prompt)} disabled={busy}>{busy ? 'Thinking…' : 'Ask Noema'}</button></div>{reply ? <div className="tutor-reply"><strong>{prompt}</strong><p>{reply}</p></div> : null}</section></div>
}

export default App
