import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleHelp,
  Cloud,
  CloudSun,
  Download,
  FileText,
  Highlighter,
  Home,
  Library,
  ListChecks,
  Link2,
  Lightbulb,
  Menu,
  MessageCircleQuestion,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import './App.css'
import {
  hydrateRemoteNotes,
  persistNote,
  readLocalNotes,
  syncPendingNotes,
  type BrainNote,
  type BrainNoteKind,
  type BrainNoteLocation,
} from './lib/knowledge'
import { epubBookFromParsed, parseEpub, pdfBookFromSource } from './lib/epub'
import {
  loadBookText,
  readLibraryBooks,
  removeLibraryBook,
  saveBookText,
  saveEpubFile,
  upsertLibraryBook,
  writeLibraryBooks,
  type LibraryBook,
} from './lib/library'
import { Reader, type NoteAction, type ReaderTutorContext, type TutorHandler } from './Reader'
import { useLatest } from './lib/useLatest'
import { BookCover } from './BookCover'
import { friendlyBookError } from './lib/text'
import { ReviewPage } from './ReviewPage'
import { markDeleted, markRestored } from './lib/tombstones'
import { retrievedContext } from './lib/retrieval'
import { syncAccountLibrary } from './lib/accountLibrary'
import { downloadBackup as downloadBackupFile, restoreBackup } from './lib/backup'
import {
  bindCloudConnectionsToUser,
  cloudConnectionForUser,
  connectCloudProvider,
  consumeCloudOAuthRedirect,
  disconnectCloudProvider,
  listCloudProviders,
  loadCloudProviderConfig,
  readCloudConnections,
  type CloudConnection,
  type CloudProviderId,
  type CloudProviderInfo,
} from './lib/cloudProviders'
import { syncCloudState } from './lib/cloudSync'
import { writeLocalNotes } from './lib/knowledge'
import {
  authHeaders,
  getCurrentSession,
  isAnonymousUser,
  sendPasswordReset,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeToAuth,
  updateProfileName,
  upgradeAnonymousAccount,
} from './lib/auth'
import type { User } from '@supabase/supabase-js'

type Note = BrainNote
type Overlay = 'brain' | 'noema' | null
type SelectionOffer = { text: string; top: number; left: number }
type NoteDraft = { title: string; body: string; source: string; kind: BrainNoteKind; location?: BrainNoteLocation }
type LibrarySort = 'recent' | 'title' | 'progress'
type LearningPath = { id: string; title: string; description: string; bookIds: string[]; createdAt: string }
type Resource = {
  id: string
  title: string
  author: string
  year?: number
  coverUrl?: string
  description?: string
  source: string
  sourceUrl: string
  downloadUrl?: string
  readerUrl?: string
  accessType?: 'public' | 'borrow'
  free: boolean
  format: string
  kind: 'book' | 'article'
}
type FocusTask = { label: string; done: boolean }
type FocusState = {
  title: string
  tasks: FocusTask[]
  durationMinutes: number
  elapsedSeconds: number
  startedAt?: number
  running: boolean
}
type UtilityOverlay = 'calendar' | 'weather' | null
type WeatherSettings = { location: string; unit: 'F' | 'C' }

const PATHS_KEY = 'noesis:paths:v1'
const PROFILE_NAME_KEY = 'noesis:profile:first-name:v1'
const FOCUS_KEY = 'noesis:focus:v1'
const WEATHER_KEY = 'noesis:weather:v1'
const navItems = [
  { label: 'Home', text: 'Home', icon: Home },
  { label: 'My Library', text: 'Library', icon: Library },
  { label: 'Read', text: 'Read', icon: BookOpen },
  { label: 'Notes', text: 'Second Brain', icon: Brain },
  { label: 'Review', text: 'Review', icon: RotateCcw },
  { label: 'Learning Paths', text: 'Paths', icon: ListChecks },
  { label: 'Explore', text: 'Explore', icon: Search },
  { label: 'Cloud Backup', text: 'Settings', icon: Settings },
  { label: 'Account', text: 'Account', icon: UserRound },
]

function readPaths(): LearningPath[] {
  try {
    const value = JSON.parse(localStorage.getItem(PATHS_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? (value as LearningPath[]) : []
  } catch {
    return []
  }
}
function writePaths(paths: LearningPath[]) {
  localStorage.setItem(PATHS_KEY, JSON.stringify(paths))
}
const defaultFocusState = (): FocusState => ({
  title: 'Today’s focus',
  tasks: [
    { label: 'Read for 30 minutes', done: false },
    { label: 'Capture 2 key ideas', done: false },
    { label: 'Reflect on one chapter', done: false },
    { label: 'Make one connection', done: false },
  ],
  durationMinutes: 30,
  elapsedSeconds: 0,
  running: false,
})
function readFocusState(): FocusState {
  try {
    const value = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? 'null') as Partial<FocusState> | null
    if (!value || !Array.isArray(value.tasks)) return defaultFocusState()
    return {
      ...defaultFocusState(),
      ...value,
      tasks: value.tasks
        .filter((task): task is FocusTask =>
          Boolean(task && typeof task === 'object' && typeof task.label === 'string'),
        )
        .map((task) => ({ label: task.label, done: Boolean(task.done) })),
    }
  } catch {
    return defaultFocusState()
  }
}
function writeFocusState(value: FocusState) {
  try {
    localStorage.setItem(FOCUS_KEY, JSON.stringify(value))
  } catch {
    /* local storage can be unavailable */
  }
}
function focusRemainingSeconds(value: FocusState, now = Date.now()): number {
  const elapsed =
    value.elapsedSeconds + (value.running && value.startedAt ? Math.floor((now - value.startedAt) / 1000) : 0)
  return Math.max(0, value.durationMinutes * 60 - elapsed)
}
function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}
function weatherLabel(value: number, unit: WeatherSettings['unit']): string {
  const temperature = unit === 'C' ? Math.round(((value - 32) * 5) / 9) : Math.round(value)
  return `${temperature}°${unit}`
}
function readWeatherSettings(): WeatherSettings {
  try {
    const value = JSON.parse(localStorage.getItem(WEATHER_KEY) ?? 'null') as Partial<WeatherSettings> | null
    return {
      location: typeof value?.location === 'string' ? value.location : 'Reading retreat',
      unit: value?.unit === 'C' ? 'C' : 'F',
    }
  } catch {
    return { location: 'Reading retreat', unit: 'F' }
  }
}
function writeWeatherSettings(value: WeatherSettings) {
  try {
    localStorage.setItem(WEATHER_KEY, JSON.stringify(value))
  } catch {
    /* local storage can be unavailable */
  }
}
function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
function readProfileName(userId?: string): string {
  try {
    return localStorage.getItem(userId ? `${PROFILE_NAME_KEY}:${userId}` : PROFILE_NAME_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}
function writeProfileName(value: string, userId?: string) {
  try {
    localStorage.setItem(userId ? `${PROFILE_NAME_KEY}:${userId}` : PROFILE_NAME_KEY, value.trim())
  } catch {
    /* local storage can be unavailable in private browsing */
  }
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
  const name = [
    metadata?.first_name,
    metadata?.given_name,
    metadata?.full_name,
    metadata?.name,
    metadata?.display_name,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (name) return firstNameFromValue(name)
  const emailName =
    user.email
      ?.split('@')[0]
      .replace(/[._-]+/g, ' ')
      .trim() ?? ''
  return firstNameFromValue(emailName)
}
function NoesisMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="noesis-mark" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M9 17.5c8.5-3 16.2-2.1 23 3.6v31.2c-6.8-5.5-14.5-6.7-23-3.7V17.5Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M55 17.5c-8.5-3-16.2-2.1-23 3.6v31.2c6.8-5.5 14.5-6.7 23-3.7V17.5Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path d="M32 21.5v30.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path
        d="M32 44c.2-7.8 3.5-13.3 9.6-17"
        stroke="var(--mark-accent, #d5ab61)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="m42.3 11.5 1.7 4.6 4.6 1.7-4.6 1.7-1.7 4.6-1.7-4.6-4.6-1.7 4.6-1.7 1.7-4.6Z"
        stroke="var(--mark-accent, #d5ab61)"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function ProgressRing({ value }: { value: number }) {
  return (
    <div
      className="progress-ring"
      style={{ '--progress': `${Math.max(0, Math.min(100, value)) * 3.6}deg` } as React.CSSProperties}
    >
      <span>{Math.round(value)}%</span>
    </div>
  )
}

function App() {
  const [books, setBooks] = useState<LibraryBook[]>(() => readLibraryBooks())
  const [notes, setNotes] = useState<Note[]>(() => readLocalNotes())
  const [paths, setPaths] = useState<LearningPath[]>(() => readPaths())
  const [now, setNow] = useState(() => new Date())
  const [activeNav, setActiveNav] = useState('Home')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('recent')
  const [resourceQuery, setResourceQuery] = useState('')
  const [resources, setResources] = useState<Resource[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [readerJump, setReaderJump] = useState<BrainNoteLocation | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [tutorPrompt, setTutorPrompt] = useState('')
  const [tutorReply, setTutorReply] = useState('')
  const [tutorContext, setTutorContext] = useState<ReaderTutorContext | null>(null)
  const [tutorBusy, setTutorBusy] = useState(false)
  const [selectionOffer, setSelectionOffer] = useState<SelectionOffer | null>(null)
  const [noteDraft, setNoteDraft] = useState<NoteDraft>({ title: '', body: '', source: '', kind: 'note' })
  const [pathDraft, setPathDraft] = useState({ title: '', description: '' })
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authName, setAuthName] = useState('')
  const [profileFirstName, setProfileFirstName] = useState(() => readProfileName())
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [authBusy, setAuthBusy] = useState(false)
  const [cloudConnections, setCloudConnections] = useState<CloudConnection[]>(() => readCloudConnections())
  const [cloudProviders, setCloudProviders] = useState<CloudProviderInfo[]>(() => listCloudProviders())
  const [cloudSyncing, setCloudSyncing] = useState(false)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const cloudReady = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const [utilityOverlay, setUtilityOverlay] = useState<UtilityOverlay>(null)
  const [focusState, setFocusState] = useState<FocusState>(() => readFocusState())
  const [focusNow, setFocusNow] = useState(() => Date.now())
  const [weatherSettings, setWeatherSettings] = useState<WeatherSettings>(() => readWeatherSettings())
  const [weatherTemperature] = useState<number | null>(56)
  const authUserRef = useLatest(authUser)
  const notesRef = useLatest(notes)
  const authUserId = authUser?.id
  const cloudConnection = cloudConnectionForUser(cloudConnections, authUserId)
  const selectedBook = useMemo(() => books.find((book) => book.id === selectedBookId) ?? null, [books, selectedBookId])
  const filteredBooks = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase()
    const matches = q ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(q)) : [...books]
    return matches.sort((a, b) =>
      librarySort === 'title'
        ? a.title.localeCompare(b.title)
        : librarySort === 'progress'
          ? b.progress - a.progress
          : b.updated.localeCompare(a.updated),
    )
  }, [books, libraryQuery, librarySort])
  const overallProgress = books.length
    ? Math.round(books.reduce((sum, book) => sum + book.progress, 0) / books.length)
    : 0
  const timeGreeting = greetingFor(now)
  const displayName = displayNameFor(authUser, profileFirstName)
  const focusRemaining = focusRemainingSeconds(focusState, focusNow)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let cancelled = false
    void loadCloudProviderConfig().then((providers) => {
      if (!cancelled) setCloudProviders(providers)
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    writeFocusState(focusState)
  }, [focusState])
  useEffect(() => {
    if (!focusState.running) return
    const timer = window.setInterval(() => setFocusNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [focusState.running])
  useEffect(() => {
    if (focusState.running && focusRemaining <= 0)
      setFocusState((current) => ({
        ...current,
        running: false,
        elapsedSeconds: current.durationMinutes * 60,
        startedAt: undefined,
      }))
  }, [focusState.running, focusRemaining])
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  useEffect(() => {
    consumeCloudOAuthRedirect()
    let cancelled = false
    void getCurrentSession()
      .then((session) => {
        if (!cancelled) setAuthUser(session?.user ?? null)
      })
      .catch(() => undefined)
    const unsubscribe = subscribeToAuth((_event, session) => setAuthUser(session?.user ?? null))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!authUser || isAnonymousUser(authUser)) {
      cloudReady.current = false
      return
    }
    const bound = bindCloudConnectionsToUser(authUser.id)
    setCloudConnections((current) => (JSON.stringify(current) === JSON.stringify(bound) ? current : bound))
  }, [authUser, authUserId])
  useEffect(() => {
    if (!authUser || isAnonymousUser(authUser)) return
    let cancelled = false
    const restore = async () => {
      try {
        const restored = await syncAccountLibrary(readLibraryBooks())
        if (!cancelled)
          setBooks((current) =>
            JSON.stringify(current) === JSON.stringify(restored) ? current : (writeLibraryBooks(restored), restored),
          )
      } catch (reason) {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : ''
          showNotice(
            /Bucket not found|NoSuchBucket/i.test(message)
              ? 'Notes are connected. Run the Noesis storage migration in Supabase to sync uploaded books.'
              : message || 'Your book files could not be synced yet. Notes are still connected.',
          )
        }
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [authUser, authUserId])
  useEffect(() => {
    const metadata = authUser?.user_metadata as Record<string, unknown> | undefined
    const metadataName =
      [metadata?.first_name, metadata?.given_name, metadata?.full_name, metadata?.name].find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      ) ?? ''
    setProfileFirstName(
      readProfileName(authUserId) || firstNameFromValue(metadataName) || (authUser ? '' : readProfileName()),
    )
  }, [authUser, authUserId])
  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      const user = authUserRef.current
      const currentNotes = notesRef.current
      const value =
        user && !isAnonymousUser(user) ? await syncPendingNotes(currentNotes) : await hydrateRemoteNotes(currentNotes)
      if (!cancelled) setNotes(value)
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [authUserId, authUserRef, notesRef])
  useEffect(() => {
    const user = authUserRef.current
    const connection = cloudConnection
    if (!user || isAnonymousUser(user) || !connection) {
      cloudReady.current = false
      return
    }
    let cancelled = false
    const run = async () => {
      setCloudSyncing(true)
      try {
        const merged = await syncCloudState(connection, { books, notes, paths })
        if (cancelled) return
        setBooks((current) =>
          JSON.stringify(current) === JSON.stringify(merged.books)
            ? current
            : (writeLibraryBooks(merged.books), merged.books),
        )
        setNotes((current) =>
          JSON.stringify(current) === JSON.stringify(merged.notes)
            ? current
            : (writeLocalNotes(merged.notes), merged.notes),
        )
        setPaths((current) =>
          JSON.stringify(current) === JSON.stringify(merged.paths)
            ? current
            : (writePaths(merged.paths as LearningPath[]), merged.paths as LearningPath[]),
        )
      } catch (reason) {
        if (!cancelled)
          showNotice(
            reason instanceof Error ? reason.message : 'Cloud sync failed. Reconnect the provider and try again.',
          )
      } finally {
        if (!cancelled) setCloudSyncing(false)
      }
    }
    if (!cloudReady.current) {
      cloudReady.current = true
      void run()
      return () => {
        cancelled = true
      }
    }
    const timer = window.setTimeout(() => void run(), 1400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [authUserId, authUserRef, cloudConnection, books, notes, paths])
  useEffect(() => {
    let timer: number | undefined
    const update = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const selection = window.getSelection()
        const text = selection?.toString().trim() ?? ''
        const node = selection?.anchorNode
        const element = node instanceof Element ? node : node?.parentElement
        if (
          !text ||
          text.length < 2 ||
          !element ||
          element.closest('[data-overlay], input, textarea, select, [contenteditable="true"]')
        ) {
          setSelectionOffer(null)
          return
        }
        const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
        if (!rect) return
        setSelectionOffer({
          text: text.slice(0, 20_000),
          left: Math.min(Math.max(rect.left + rect.width / 2, 110), window.innerWidth - 110),
          top: rect.bottom + 10 < window.innerHeight - 50 ? rect.bottom + 10 : Math.max(8, rect.top - 52),
        })
      }, 20)
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('keyup', update)
    return () => {
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('keyup', update)
    }
  }, [])
  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3800)
  }
  function updateFocusState(updater: (current: FocusState) => FocusState) {
    setFocusState((current) => updater(current))
  }
  function startFocusTimer() {
    updateFocusState((current) => ({
      ...current,
      running: focusRemainingSeconds(current) > 0,
      startedAt: Date.now(),
      elapsedSeconds: current.durationMinutes * 60 - focusRemainingSeconds(current),
    }))
  }
  function pauseFocusTimer() {
    updateFocusState((current) => ({
      ...current,
      running: false,
      startedAt: undefined,
      elapsedSeconds: current.durationMinutes * 60 - focusRemainingSeconds(current),
    }))
  }
  function resetFocusTimer() {
    updateFocusState((current) => ({ ...current, running: false, startedAt: undefined, elapsedSeconds: 0 }))
  }
  function setFocusDuration(minutes: number) {
    updateFocusState((current) => ({
      ...current,
      durationMinutes: Math.max(1, minutes),
      elapsedSeconds: 0,
      startedAt: undefined,
      running: false,
    }))
  }
  function toggleFocusTask(index: number) {
    updateFocusState((current) => ({
      ...current,
      tasks: current.tasks.map((task, taskIndex) => (taskIndex === index ? { ...task, done: !task.done } : task)),
    }))
  }
  function selectNav(label: string) {
    setMobileNavOpen(false)
    if (label === 'Second Brain' || label === 'Notes') {
      setOverlay('brain')
      return
    }
    if (label === 'Ask Noema') {
      setOverlay('noema')
      return
    }
    setActiveNav(label)
    setSelectedBookId(label === 'Read' ? selectedBookId : null)
  }
  function openNotePanel(seed = '', action: NoteAction = seed ? 'highlight' : 'note', location?: BrainNoteLocation) {
    const labels: Record<NoteAction, { title: string; kind: BrainNoteKind }> = {
      highlight: { title: 'Saved highlight', kind: 'highlight' },
      note: { title: '', kind: 'note' },
      question: { title: 'Question', kind: 'question' },
      reflect: { title: 'Reflection', kind: 'idea' },
      connect: { title: 'Connection', kind: 'connection' },
    }
    const choice = labels[action]
    const sourceLocation =
      location ??
      (selectedBook
        ? {
            bookId: selectedBook.id,
            bookTitle: selectedBook.title,
            author: selectedBook.author,
            chapter: selectedBook.chapter,
            chapterIndex: selectedBook.chapterIndex,
            href: selectedBook.currentHref,
            cfi: selectedBook.cfi,
          }
        : undefined)
    const source = sourceLocation?.bookTitle
      ? `${sourceLocation.bookTitle}${sourceLocation.chapter ? ` · ${sourceLocation.chapter}` : ''}${sourceLocation.page ? ` · p. ${sourceLocation.page}` : ''}`
      : 'Noesis'
    setNoteDraft({ title: choice.title, body: seed, source, kind: choice.kind, location: sourceLocation })
    setOverlay('brain')
  }
  function openNoemaPanel(seed = '', context?: ReaderTutorContext) {
    setTutorPrompt(seed)
    setTutorContext(context ?? null)
    setTutorReply('')
    setOverlay('noema')
  }
  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const isEpub = file.name.toLowerCase().endsWith('.epub')
    const isPdf = file.name.toLowerCase().endsWith('.pdf')
    if (!isEpub && !isPdf) {
      showNotice('Noesis imports EPUB and PDF files.')
      return
    }
    try {
      const data = await file.arrayBuffer()
      const parsed = isEpub ? await parseEpub(data, file.name) : null
      const book = parsed
        ? epubBookFromParsed(`epub-${crypto.randomUUID()}`, file.name, file.size, parsed)
        : pdfBookFromSource(
            `pdf-${crypto.randomUUID()}`,
            file.name,
            file.size,
            file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '),
            'Imported PDF',
          )
      await saveEpubFile(book.id, data)
      if (parsed?.text) await saveBookText(book.id, parsed.text)
      const nextBooks = upsertLibraryBook(book)
      setBooks(nextBooks)
      if (authUser && !isAnonymousUser(authUser)) {
        void syncAccountLibrary(nextBooks)
          .then((synced) => setBooks(synced))
          .catch(() => undefined)
      }
      setSelectedBookId(book.id)
      setActiveNav('Read')
      showNotice(`${book.title} was added to your library.`)
    } catch (reason) {
      showNotice(friendlyBookError(reason, 'Could not read that file.'))
    }
  }
  function updateBookProgress(
    id: string,
    progress: number,
    cfi?: string,
    href?: string,
    chapter?: string,
    chapterIndex?: number,
    chapterProgress?: number,
  ) {
    setBooks((current) => {
      const next = current.map((book) =>
        book.id === id
          ? {
              ...book,
              progress,
              cfi: cfi ?? book.cfi,
              currentHref: href ?? book.currentHref,
              chapter: chapter ?? book.chapter,
              chapterIndex: chapterIndex ?? book.chapterIndex,
              chapterProgress: chapterProgress ?? book.chapterProgress,
              updated: new Date().toISOString(),
            }
          : book,
      )
      const changed = next.find((book) => book.id === id)
      if (changed) upsertLibraryBook(changed)
      return next
    })
  }
  function toggleBookmark(id: string) {
    setBooks((current) => {
      const next = current.map((book) =>
        book.id === id ? { ...book, bookmarked: !book.bookmarked, updated: new Date().toISOString() } : book,
      )
      const changed = next.find((book) => book.id === id)
      if (changed) upsertLibraryBook(changed)
      return next
    })
  }
  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = noteDraft.body.trim()
    if (body.length < 2) {
      showNotice('Write a note or highlight first.')
      return
    }
    const note: Note = {
      id: `local-${crypto.randomUUID()}`,
      kind: noteDraft.kind,
      title: noteDraft.title.trim() || (noteDraft.kind === 'highlight' ? 'Highlight' : 'Quick note'),
      body,
      source: noteDraft.source.trim() || 'Noesis',
      createdAt: new Date().toISOString(),
      ...noteDraft.location,
    }
    setNotes((current) => [note, ...current])
    setNoteDraft({ title: '', body: '', source: '', kind: 'note' })
    const destination = await persistNote(note)
    showNotice(
      destination === 'remote'
        ? 'Saved to your Second Brain.'
        : 'Saved on this device. It will sync when Supabase is available.',
    )
  }
  async function askNoema(prompt: string, readingContext?: ReaderTutorContext) {
    const question = prompt.trim()
    if (!question) return
    const activeContext = readingContext ?? tutorContext
    if (readingContext) setTutorContext(readingContext)
    setTutorPrompt(question)
    setTutorReply('')
    setTutorBusy(true)
    let bookText = ''
    if (selectedBook?.format === 'epub') bookText = (await loadBookText(selectedBook.id).catch(() => '')) || ''
    const contextText = notes
      .slice(0, 30)
      .map((note) => `${note.title} (${note.source}): ${note.body}`)
      .join('\n\n')
    const position = activeContext
      ? [
          `Reading position: ${activeContext.chapter ?? 'Current chapter'}${activeContext.page ? ` · page ${activeContext.page}` : ''}`,
          activeContext.selectedText ? `Selected passage:\n${activeContext.selectedText.slice(0, 8_000)}` : '',
          activeContext.visibleText ? `Visible reading text:\n${activeContext.visibleText}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : ''
    const additionalBookText =
      selectedBook?.format === 'epub' && bookText
        ? `Additional book context:\n${retrievedContext(bookText, `${question} ${activeContext?.selectedText ?? ''}`, activeContext?.visibleText ? 10_000 : 24_000)}`
        : ''
    const bookContext = selectedBook
      ? [
          `Title: ${selectedBook.title}`,
          `Author: ${selectedBook.author}`,
          `Current location: ${activeContext?.chapter ?? selectedBook.chapter}`,
          `Format: ${selectedBook.format}`,
          activeContext?.bookTitle ? `Reader source: ${activeContext.bookTitle}` : '',
          position,
          selectedBook.description ? `Catalog description: ${selectedBook.description}` : '',
          selectedBook.accessType
            ? `Access: ${selectedBook.accessType === 'borrow' ? 'borrowed from an external library' : 'public hosted reader'}`
            : '',
          selectedBook.sourceName ? `Provider: ${selectedBook.sourceName}` : '',
          additionalBookText,
          selectedBook.format === 'web' || selectedBook.format === 'resource'
            ? 'The full text may be inside a cross-origin or protected reader. Use only supplied notes or pasted passages and do not claim to have read unavailable text.'
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : position
    try {
      const response = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ question, book: bookContext, context: contextText }),
      })
      const result = (await response.json()) as { ok?: boolean; text?: string; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || 'Noema could not answer right now.')
      setTutorReply(result.text ?? 'Noema returned an empty answer.')
      showNotice(
        activeContext?.visibleText || activeContext?.selectedText
          ? 'Noema answered from the page you are reading.'
          : 'Noema answered using your current context.',
      )
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Noema could not answer right now.'
      setTutorReply(message)
      showNotice(message)
    } finally {
      setTutorBusy(false)
    }
  }
  async function searchResources(event?: React.FormEvent) {
    event?.preventDefault()
    const query = resourceQuery.trim()
    if (!query) return
    setSearching(true)
    setResources([])
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
      const result = (await response.json()) as { ok?: boolean; results?: Resource[]; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || 'Search is unavailable.')
      setResources(result.results ?? [])
      if ((result.results ?? []).length === 0) showNotice('No free resources matched that search.')
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Search is unavailable.')
    } finally {
      setSearching(false)
    }
  }
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
          : pdfBookFromSource(
              `pdf-${crypto.randomUUID()}`,
              filename,
              data.byteLength,
              resource.title,
              resource.author,
              resource.sourceUrl,
              resource.coverUrl,
            )
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
  function openSavedBook(book: LibraryBook) {
    setReaderJump(null)
    setSelectedBookId(book.id)
    setActiveNav('Read')
  }
  function openNoteLocation(note: Note) {
    const book = note.bookId
      ? books.find((item) => item.id === note.bookId)
      : books.find((item) => note.bookTitle && item.title === note.bookTitle)
    if (!book) {
      showNotice('The original book is not on this device.')
      return
    }
    setReaderJump({
      bookId: book.id,
      bookTitle: book.title,
      author: book.author,
      chapter: note.chapter,
      chapterIndex: note.chapterIndex,
      page: note.page,
      href: note.href,
      cfi: note.cfi,
    })
    setSelectedBookId(book.id)
    setActiveNav('Read')
    setOverlay(null)
  }
  function createPath(event: React.FormEvent) {
    event.preventDefault()
    if (!pathDraft.title.trim()) return
    const path: LearningPath = {
      id: `path-${crypto.randomUUID()}`,
      title: pathDraft.title.trim(),
      description: pathDraft.description.trim() || 'A personal collection for focused study.',
      bookIds: [],
      createdAt: new Date().toISOString(),
    }
    const next = [path, ...paths]
    setPaths(next)
    writePaths(next)
    setPathDraft({ title: '', description: '' })
    showNotice('Learning path created.')
  }
  function deleteBook(book: LibraryBook) {
    if (!window.confirm(`Remove ${book.title} from your library?`)) return
    setBooks(removeLibraryBook(book.id))
    if (selectedBookId === book.id) setSelectedBookId(null)
    showNotice(`${book.title} was removed.`)
  }
  async function restorePayload(payload: Awaited<ReturnType<typeof restoreBackup>>) {
    setBooks(payload.books)
    setNotes(payload.notes)
    const restoredPaths = payload.paths as LearningPath[]
    // Restoring a backup re-adds items that may have been deleted earlier.
    payload.books.forEach((book) => markRestored('book', book.id))
    payload.notes.forEach((note) => markRestored('note', note.id))
    restoredPaths.forEach((path) => markRestored('path', path.id))
    setPaths(restoredPaths)
    writeLocalNotes(payload.notes)
    writeLibraryBooks(payload.books)
    writePaths(restoredPaths)
    showNotice(`Restored ${payload.books.length} books and ${payload.notes.length} notes.`)
  }
  async function handleBackupImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      await restorePayload(await restoreBackup(file))
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Could not restore that backup.')
    }
  }
  async function connectCloud(id: CloudProviderId) {
    if (!authUser || isAnonymousUser(authUser)) {
      showNotice('Sign in to Noesis before connecting a personal cloud provider.')
      setActiveNav('Account')
      return
    }
    try {
      await connectCloudProvider(id, authUser.id)
      setCloudConnections(readCloudConnections())
      showNotice('Cloud provider connected. Noesis will sync your library automatically.')
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Cloud connection failed.')
    }
  }
  function disconnectCloud(id: CloudProviderId) {
    setCloudConnections(disconnectCloudProvider(id))
    cloudReady.current = false
    showNotice('Cloud provider disconnected. Your local library is unchanged.')
  }
  async function syncNow(providerId?: CloudProviderId) {
    const connection = providerId
      ? cloudConnectionForUser(
          cloudConnections.filter((item) => item.provider === providerId),
          authUserId,
        )
      : cloudConnection
    if (!connection) {
      showNotice('Sign in and connect the same provider to sync your books.')
      return
    }
    setCloudSyncing(true)
    try {
      const merged = await syncCloudState(connection, { books, notes, paths })
      setBooks(merged.books)
      setNotes(merged.notes)
      setPaths(merged.paths as LearningPath[])
      writeLibraryBooks(merged.books)
      writeLocalNotes(merged.notes)
      writePaths(merged.paths as LearningPath[])
      showNotice(
        `${connection.provider === 'google-drive' ? 'Google Drive' : connection.provider === 'onedrive' ? 'OneDrive' : 'Dropbox'} sync completed.`,
      )
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Cloud sync failed.')
    } finally {
      setCloudSyncing(false)
    }
  }
  async function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = authEmail.trim()
    if (!email || authPassword.length < 6) {
      showNotice('Enter an email and a password with at least six characters.')
      return
    }
    setAuthBusy(true)
    try {
      if (authMode === 'sign-up' && isAnonymousUser(authUser)) {
        const session = await upgradeAnonymousAccount(email, authPassword, authName)
        setAuthUser(session?.user ?? authUser)
        showNotice('Your account is ready. Your current notes stay connected to it.')
      } else if (authMode === 'sign-up') {
        const result = await signUpWithPassword(email, authPassword, authName)
        setAuthUser(result.user)
        showNotice(
          result.session ? 'Account created and signed in.' : 'Account created. Check your email to confirm it.',
        )
      } else {
        const session = await signInWithPassword(email, authPassword)
        setAuthUser(session.user)
        showNotice('Signed in. Your notes and backup are connected.')
      }
      setAuthPassword('')
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Authentication failed.')
    } finally {
      setAuthBusy(false)
    }
  }
  async function saveFirstName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = profileFirstName.trim()
    writeProfileName(value, authUserId)
    if (authUser && !isAnonymousUser(authUser)) {
      try {
        setAuthUser(await updateProfileName(value))
      } catch (reason) {
        showNotice(reason instanceof Error ? reason.message : 'Your first name could not be saved.')
        return
      }
    }
    setProfileFirstName(value)
    showNotice(value ? 'Your first name was saved.' : 'Your first name was cleared.')
  }
  async function handleResetPassword() {
    const email = authEmail.trim()
    if (!email) {
      showNotice('Enter your email first, then choose password reset.')
      return
    }
    try {
      await sendPasswordReset(email)
      showNotice('Password reset instructions sent.')
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Could not send password reset instructions.')
    }
  }
  async function handleSignOut() {
    try {
      await signOut()
      setAuthUser(null)
      showNotice('Signed out. Your local library and provider connection remain on this device.')
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Could not sign out.')
    }
  }
  function focusPage() {
    const completed = focusState.tasks.filter((task) => task.done).length
    return (
      <Page
        title={focusState.title}
        subtitle="Choose one quiet intention, set a timer, and let the reading session begin."
      >
        <div className="focus-workspace">
          <section className="focus-plan panel-card">
            <div className="focus-panel-heading">
              <div>
                <p className="eyebrow">Your intention</p>
                <h3>Set today’s focus</h3>
              </div>
              <button className="text-button" type="button" onClick={resetFocusTimer}>
                Reset timer
              </button>
            </div>
            <label className="focus-title-field">
              Focus title
              <input
                value={focusState.title}
                onChange={(event) => updateFocusState((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <div className="focus-task-editor">
              {focusState.tasks.map((task, index) => (
                <label className="focus-task-editor-row" key={`${task.label}-${index}`}>
                  <input type="checkbox" checked={task.done} onChange={() => toggleFocusTask(index)} />
                  <input
                    value={task.label}
                    onChange={(event) =>
                      updateFocusState((current) => ({
                        ...current,
                        tasks: current.tasks.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, label: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <button
              className="secondary-button focus-add-task"
              type="button"
              onClick={() =>
                updateFocusState((current) => ({
                  ...current,
                  tasks: [...current.tasks, { label: 'New focus step', done: false }],
                }))
              }
            >
              <Plus size={14} /> Add focus step
            </button>
            <small className="focus-completion">
              {completed} of {focusState.tasks.length} steps complete
            </small>
          </section>
          <section className="focus-timer-panel panel-card">
            <div className="focus-panel-heading">
              <div>
                <p className="eyebrow">Reading timer</p>
                <h3>Protect the session</h3>
              </div>
              <select
                value={focusState.durationMinutes}
                onChange={(event) => setFocusDuration(Number(event.target.value))}
                aria-label="Focus duration"
              >
                <option value="15">15 minutes</option>
                <option value="25">25 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>
            <div className={`focus-timer-display ${focusState.running ? 'focus-timer-running' : ''}`}>
              {formatTimer(focusRemaining)}
            </div>
            <p className="focus-timer-status">
              {focusState.running
                ? 'Focus session in progress'
                : focusRemaining < focusState.durationMinutes * 60
                  ? 'Session paused'
                  : 'Ready when you are.'}
            </p>
            <div className="focus-timer-actions">
              <button
                className="primary-button"
                type="button"
                onClick={focusState.running ? pauseFocusTimer : startFocusTimer}
              >
                {focusState.running ? <Pause size={15} /> : <Play size={15} />}
                {focusState.running
                  ? 'Pause'
                  : focusRemaining < focusState.durationMinutes * 60
                    ? 'Resume'
                    : 'Start focus'}
              </button>
              <button className="secondary-button" type="button" onClick={resetFocusTimer}>
                <RotateCcw size={15} /> Reset
              </button>
            </div>
          </section>
        </div>
      </Page>
    )
  }
  function homePage() {
    const current = books.find((book) => book.progress > 0 && book.progress < 100) ?? books[0]
    return (
      <div className="reading-home">
        <section className="home-reading-hero">
          <div className="home-hero-content">
            <p className="eyebrow">Your reading space</p>
            <h2>
              {timeGreeting}
              {displayName ? `, ${displayName}.` : '.'}
            </h2>
            <p>Pick up where you left off, or choose your next read.</p>
            {current ? (
              <div className="hero-continue">
                <div className="continue-cover-wrap">
                  <BookCover book={current} />
                </div>
                <div className="continue-details">
                  <p className="eyebrow">Continue reading</p>
                  <h2>{current.title}</h2>
                  <p className="muted">{current.author}</p>
                  <p className="chapter-line">
                    <BookOpen size={14} /> {current.chapter || 'Opening chapter'}
                  </p>
                  <div className="progress-row">
                    <div className="progress-track">
                      <span style={{ width: `${current.progress}%` }} />
                    </div>
                    <strong>{Math.round(current.progress)}%</strong>
                  </div>
                  <div className="hero-continue-actions">
                    <button className="primary-button" onClick={() => openSavedBook(current)}>
                      Continue reading <ArrowRight size={16} />
                    </button>
                    <button className="icon-button" onClick={() => openNotePanel('', 'note')} aria-label="Add a note">
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button className="hero-empty-reading" onClick={() => fileInput.current?.click()}>
                <Plus size={18} /> Add your first book
              </button>
            )}
          </div>
          <div className="home-hero-mark">
            <NoesisMark size={34} />
            <span>NOESIS</span>
            <small>by Proairetos</small>
          </div>
        </section>
        <FocusHomeWidget
          focus={focusState}
          remaining={focusRemaining}
          onOpen={() => selectNav('Focus')}
          onToggle={focusState.running ? pauseFocusTimer : startFocusTimer}
        />
        <ReadingShelfSection
          books={filteredBooks.slice(0, 6)}
          onOpen={openSavedBook}
          onImport={() => fileInput.current?.click()}
        />
        <PathSection paths={paths} books={books} onOpen={() => selectNav('Learning Paths')} />
        <NotesSection notes={notes} onOpen={() => setOverlay('brain')} onOpenNote={openNoteLocation} />
        <SuggestedSection resources={resources} onExplore={() => selectNav('Explore')} />
      </div>
    )
  }
  function readPage() {
    return (
      <Page title="Read" subtitle="">
        <section className="reader-landing panel-card">
          <BookOpen size={22} />
          <strong>{books.length ? 'Choose a title' : 'Your reader is empty'}</strong>
          <button className="primary-button" onClick={() => fileInput.current?.click()}>
            <Upload size={14} /> Add book
          </button>
        </section>
        <BookSection books={books} onOpen={openSavedBook} />
      </Page>
    )
  }
  function libraryPage() {
    return (
      <Page
        title="My library"
        subtitle={`${books.length} ${books.length === 1 ? 'title' : 'titles'} saved on this device.`}
      >
        <div className="page-toolbar">
          <div className="field-with-icon">
            <Search size={15} />
            <input
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder="Search your library"
            />
          </div>
          <div className="page-toolbar-actions">
            <select
              className="library-sort"
              value={librarySort}
              onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
              aria-label="Sort library"
            >
              <option value="recent">Recently added</option>
              <option value="title">Title</option>
              <option value="progress">Progress</option>
            </select>
            <button className="primary-button" onClick={() => fileInput.current?.click()}>
              <Upload size={15} /> Add a book
            </button>
          </div>
        </div>
        <BookSection
          books={filteredBooks}
          onOpen={openSavedBook}
          onImport={() => fileInput.current?.click()}
          onDelete={deleteBook}
        />
      </Page>
    )
  }
  function pathsPage() {
    return (
      <Page title="Learning paths" subtitle="Group books around a question, skill, or long-term goal.">
        <form className="create-form panel-card" onSubmit={createPath}>
          <input
            value={pathDraft.title}
            onChange={(event) => setPathDraft({ ...pathDraft, title: event.target.value })}
            placeholder="Path name, e.g. Cognitive psychology"
          />
          <input
            value={pathDraft.description}
            onChange={(event) => setPathDraft({ ...pathDraft, description: event.target.value })}
            placeholder="What do you want this path to help you understand?"
          />
          <button className="primary-button" type="submit">
            <Plus size={15} /> Create path
          </button>
        </form>
        <PathSection
          paths={paths}
          books={books}
          editable
          onDelete={(id) => {
            const next = paths.filter((path) => path.id !== id)
            markDeleted('path', id)
            setPaths(next)
            writePaths(next)
          }}
          onAssign={(pathId, bookId) => {
            const next = paths.map((path) =>
              path.id === pathId && bookId && !path.bookIds.includes(bookId)
                ? { ...path, bookIds: [...path.bookIds, bookId] }
                : path,
            )
            setPaths(next)
            writePaths(next)
          }}
        />
      </Page>
    )
  }
  function notesPage() {
    return (
      <Page title="Notes" subtitle="Your highlights, questions, and ideas in one place.">
        <NotesSection notes={notes} expanded onOpen={openNotePanel} onOpenNote={openNoteLocation} />
      </Page>
    )
  }
  function progressPage() {
    const readCount = books.filter((book) => book.progress > 0).length
    return (
      <Page title="Progress" subtitle="A clear view of the reading you have actually done.">
        <div className="metric-grid">
          <Metric label="Overall progress" value={`${overallProgress}%`} detail="Across your library" />
          <Metric label="Books started" value={`${readCount}`} detail={`of ${books.length} saved titles`} />
          <Metric label="Notes saved" value={`${notes.length}`} detail="In your Second Brain" />
          <Metric label="Learning paths" value={`${paths.length}`} detail="Created by you" />
        </div>
        <div className="progress-list panel-card">
          <h3>Reading progress</h3>
          {books.length === 0 ? (
            <div className="empty-state">Add a book or save a reading source to track progress here.</div>
          ) : (
            books.map((book) => (
              <div className="progress-book" key={book.id}>
                <BookCover book={book} compact />
                <div>
                  <strong>{book.title}</strong>
                  <span>{book.author}</span>
                  <div className="progress-track">
                    <span style={{ width: `${book.progress}%` }} />
                  </div>
                </div>
                <b>{Math.round(book.progress)}%</b>
              </div>
            ))
          )}
        </div>
      </Page>
    )
  }
  function explorePage() {
    const localMatches = resourceQuery.trim()
      ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(resourceQuery.toLowerCase()))
      : []
    return (
      <Page title="Explore" subtitle="Search books, open-access articles, journals, and academic papers.">
        <form className="explore-search panel-card" onSubmit={searchResources}>
          <Search size={18} />
          <input
            value={resourceQuery}
            onChange={(event) => setResourceQuery(event.target.value)}
            placeholder="What do you want to learn?"
          />
          <button className="primary-button" type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {localMatches.length > 0 ? (
          <section className="resource-section">
            <div className="section-heading">
              <div>
                <h2>In your library</h2>
                <p>Books and documents already saved here.</p>
              </div>
            </div>
            <BookSection books={localMatches} onOpen={openSavedBook} />
          </section>
        ) : null}
        <section className="resource-section">
          <div className="section-heading">
            <div>
              <h2>Books and research</h2>
              <p>
                Project Gutenberg, Open Library, OpenAlex, and Internet Archive. Import files or read official source
                pages inside Noesis.
              </p>
            </div>
          </div>
          {resources.length === 0 && !searching ? (
            <div className="empty-state">Search for a topic, author, journal, or research question.</div>
          ) : (
            <div className="resource-grid">
              {resources.map((resource) => (
                <article className="resource-card panel-card" key={`${resource.source}-${resource.id}`}>
                  <div className="resource-cover">
                    {resource.coverUrl ? (
                      <img src={resource.coverUrl} alt="" />
                    ) : resource.kind === 'article' ? (
                      <FileText size={22} />
                    ) : (
                      <BookOpen size={22} />
                    )}
                  </div>
                  <div>
                    <span className="resource-source">
                      {resource.source} · {resource.format}
                    </span>
                    <h3>{resource.title}</h3>
                    <p>
                      {resource.author}
                      {resource.year ? ` · ${resource.year}` : ''}
                    </p>
                    <div className="resource-actions">
                      <button
                        className="secondary-button"
                        onClick={() => window.open(resource.sourceUrl, '_blank', 'noopener,noreferrer')}
                      >
                        Open source
                      </button>
                      <button className="primary-button" onClick={() => void addResource(resource)}>
                        <Plus size={14} />{' '}
                        {resource.readerUrl ? 'Read in Noesis' : resource.downloadUrl ? 'Import' : 'Save link'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </Page>
    )
  }
  function backupPage() {
    const signedIn = Boolean(authUser && !isAnonymousUser(authUser))
    return (
      <Page title="Cloud backup" subtitle="Keep your library synced across devices with storage you control.">
        <section className="profile-settings panel-card">
          <div>
            <p className="eyebrow">Personalize Noesis</p>
            <h3>Your greeting</h3>
            <p>
              Set the first name Noesis should use on the home page. Leave it blank to use your account name or the
              first part of your email.
            </p>
          </div>
          <form className="profile-name-form" onSubmit={saveFirstName}>
            <label>
              First name
              <input
                value={profileFirstName}
                onChange={(event) => setProfileFirstName(event.target.value)}
                placeholder="e.g. David"
                autoComplete="given-name"
              />
            </label>
            <button className="primary-button" type="submit">
              Save name
            </button>
          </form>
        </section>
        <section className="backup-hero panel-card">
          <div className="backup-icon">
            <Cloud size={24} />
          </div>
          <div>
            <h3>Live cloud sync</h3>
            <p>
              Noesis syncs your library manifest, notes, paths, and each local EPUB as separate files. When you sign in
              on another device and connect the same provider, your reading data and books are restored without a ZIP
              archive.
            </p>
            <small>
              {!online
                ? 'You are offline. Changes will stay on this device until you reconnect.'
                : !signedIn
                  ? 'Sign in from Account before connecting a personal cloud provider.'
                  : cloudSyncing
                    ? 'Syncing your latest changes…'
                    : cloudConnections.length
                      ? 'Connected and syncing automatically.'
                      : 'Connect one provider below to begin.'}
            </small>
          </div>
        </section>
        <section className="cloud-provider-grid">
          {cloudProviders.map((provider) => {
            const connection = signedIn
              ? cloudConnectionForUser(
                  cloudConnections.filter((item) => item.provider === provider.id),
                  authUser?.id,
                )
              : undefined
            const expired = Boolean(connection && connection.expiresAt <= Date.now() + 30_000)
            return (
              <article className="cloud-provider-card panel-card" key={provider.id}>
                <div className="cloud-provider-head">
                  <div className="backup-icon">
                    <Cloud size={18} />
                  </div>
                  <div>
                    <h3>{provider.label}</h3>
                    <p>{provider.description}</p>
                  </div>
                  <span className={connection && !expired ? 'cloud-status cloud-status-connected' : 'cloud-status'}>
                    {connection
                      ? expired
                        ? 'Reconnect'
                        : 'Connected'
                      : provider.configured
                        ? 'Ready'
                        : 'Setup needed'}
                  </span>
                </div>
                {connection && !expired ? (
                  <div className="cloud-provider-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void syncNow(provider.id)}
                      disabled={cloudSyncing || !online}
                    >
                      <RotateCcw size={14} /> {cloudSyncing ? 'Syncing…' : 'Sync now'}
                    </button>
                    <button className="secondary-button" onClick={() => disconnectCloud(provider.id)}>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="cloud-provider-actions">
                    <button
                      className="primary-button"
                      onClick={() => void connectCloud(provider.id)}
                      disabled={!signedIn || !provider.configured || !online}
                    >
                      <Cloud size={14} /> {expired ? 'Reconnect' : 'Connect'} {provider.label}
                    </button>
                    <a className="cloud-setup-link" href={provider.setupUrl} target="_blank" rel="noreferrer">
                      Provider setup
                    </a>
                  </div>
                )}
                {!provider.configured ? (
                  <p className="cloud-provider-note">
                    Add the provider client ID/app key as a Cloudflare build or Worker variable, then redeploy.
                  </p>
                ) : null}
              </article>
            )
          })}
        </section>
        <div className="backup-actions">
          <button className="secondary-button" onClick={() => void downloadBackupFile(books, notes, paths)}>
            <Download size={15} /> Export a local ZIP
          </button>
          <button className="secondary-button" onClick={() => backupInput.current?.click()}>
            <Upload size={15} /> Restore a local export
          </button>
        </div>
        <div className="backup-note panel-card">
          <strong>How another device gets your EPUBs</strong>
          <p>
            Sign in to the same Noesis account, connect the same provider, and Noesis downloads the separate EPUB files
            and metadata into that device’s local reader. A provider connection is per device by design; Noesis never
            stores your provider password.
          </p>
        </div>
      </Page>
    )
  }
  function accountPage() {
    const anonymous = isAnonymousUser(authUser)
    return (
      <Page title="Account" subtitle="Use one account to keep notes and backups connected.">
        {authUser && !anonymous ? (
          <section className="account-signed panel-card">
            <div className="account-avatar">
              <UserRound size={22} />
            </div>
            <div>
              <span className="eyebrow">Signed in</span>
              <h3>{displayName || authUser.email}</h3>
              <p>{authUser.email} · Your Second Brain and cloud backup use this account.</p>
            </div>
            <button className="secondary-button" onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </section>
        ) : (
          <form className="auth-form panel-card" onSubmit={handleAuth}>
            <div className="auth-tabs">
              <button
                type="button"
                className={authMode === 'sign-in' ? 'auth-tab-active' : ''}
                onClick={() => setAuthMode('sign-in')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={authMode === 'sign-up' ? 'auth-tab-active' : ''}
                onClick={() => setAuthMode('sign-up')}
              >
                Create account
              </button>
            </div>
            {anonymous ? (
              <div className="auth-callout">
                <Sparkles size={15} /> Create an account to preserve this anonymous session’s notes and use the same
                library on another device.
              </div>
            ) : null}
            {authMode === 'sign-up' ? (
              <label>
                Name
                <input
                  autoComplete="name"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
            ) : null}
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
            <button className="primary-button" type="submit" disabled={authBusy}>
              {authBusy
                ? 'Working…'
                : authMode === 'sign-in'
                  ? 'Sign in'
                  : anonymous
                    ? 'Save this account'
                    : 'Create account'}
            </button>
            {authMode === 'sign-in' ? (
              <button type="button" className="text-button auth-reset" onClick={() => void handleResetPassword()}>
                Forgot password?
              </button>
            ) : null}
            <p className="auth-footnote">
              Your library stays available locally. Sign in when you want notes and cloud sync on another device.
            </p>
          </form>
        )}
      </Page>
    )
  }
  const page =
    selectedBook && activeNav === 'Read' ? (
      <Reader
        book={selectedBook}
        notes={notes}
        onClose={() => {
          setSelectedBookId(null)
          setReaderJump(null)
          setActiveNav('My Library')
        }}
        onProgress={(progress, cfi, href, chapter, chapterIndex, chapterProgress) =>
          updateBookProgress(selectedBook.id, progress, cfi, href, chapter, chapterIndex, chapterProgress)
        }
        onNote={openNotePanel}
        onOpenNote={openNoteLocation}
        onAsk={openNoemaPanel}
        onBookmark={() => toggleBookmark(selectedBook.id)}
        initialLocation={readerJump}
      />
    ) : activeNav === 'Home' ? (
      homePage()
    ) : activeNav === 'Focus' ? (
      focusPage()
    ) : activeNav === 'My Library' ? (
      libraryPage()
    ) : activeNav === 'Learning Paths' ? (
      pathsPage()
    ) : activeNav === 'Read' ? (
      readPage()
    ) : activeNav === 'Notes' ? (
      notesPage()
    ) : activeNav === 'Review' ? (
      <Page title="Review" subtitle="Short questions from your own notes, scheduled so you remember them.">
        <ReviewPage notes={notes} onNotice={showNotice} />
      </Page>
    ) : activeNav === 'Progress' ? (
      progressPage()
    ) : activeNav === 'Explore' ? (
      explorePage()
    ) : activeNav === 'Cloud Backup' ? (
      backupPage()
    ) : activeNav === 'Account' ? (
      accountPage()
    ) : (
      <div className="empty-state">Choose a page from the navigation.</div>
    )
  return (
    <div className="app-shell">
      <div className="ambient ambient-top" />
      <div className="ambient ambient-bottom" />
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-image" aria-hidden="true" />
        <div className="sidebar-content">
          <div className="brand-row">
            <div className="brand-mark">
              <NoesisMark size={22} />
            </div>
            <div>
              <strong>NOESIS</strong>
              <span>by Proairetos</span>
            </div>
            <button
              className="icon-button sidebar-close"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          </div>
          <nav className="main-nav" aria-label="Main navigation">
            {navItems.map(({ label, text, icon: Icon }) => (
              <button
                key={label}
                className={`nav-item ${activeNav === label ? 'nav-item-active' : ''}`}
                onClick={() => selectNav(label)}
                title={text}
              >
                <Icon size={17} />
                <span>{text}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-search">
              <Search size={16} />
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search your library"
                aria-label="Search your library"
              />
            </div>
            <div className="quick-icon-row">
              <button
                className="quick-icon"
                onClick={() => openNotePanel()}
                aria-label="Open Second Brain"
                title="Second Brain"
              >
                <Brain size={16} />
              </button>
              <button
                className="quick-icon"
                onClick={() => fileInput.current?.click()}
                aria-label="Add EPUB or PDF"
                title="Add book"
              >
                <Plus size={16} />
              </button>
              <button
                className="quick-icon"
                onClick={() => selectNav('Learning Paths')}
                aria-label="Create learning path"
                title="Create path"
              >
                <ListChecks size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      {mobileNavOpen ? (
        <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
      ) : null}
      <main className="main-column">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="greeting">
            <p className="eyebrow">{navItems.find((item) => item.label === activeNav)?.text ?? activeNav}</p>
            <h1>
              {activeNav === 'Home' ? 'Noesis' : (navItems.find((item) => item.label === activeNav)?.text ?? activeNav)}
            </h1>
          </div>
          <button
            className="icon-button compact-tool-button"
            onClick={() => setOverlay('brain')}
            aria-label="Open Second Brain"
            title="Second Brain"
          >
            <Brain size={17} />
          </button>
          <button
            className="icon-button compact-tool-button"
            onClick={() => openNoemaPanel()}
            aria-label="Ask Noema"
            title="Ask Noema"
          >
            <Sparkles size={17} />
          </button>
          <button className="account-top-button" onClick={() => selectNav('Account')} aria-label="Open account">
            {displayName?.slice(0, 1).toUpperCase() || <UserRound size={16} />}
          </button>
        </header>
        <div className="page-content">{page}</div>
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <button className={activeNav === 'Home' ? 'mobile-bottom-active' : ''} onClick={() => selectNav('Home')}>
            <Home size={17} />
            <span>Home</span>
          </button>
          <button
            className={activeNav === 'My Library' ? 'mobile-bottom-active' : ''}
            onClick={() => selectNav('My Library')}
          >
            <Library size={17} />
            <span>Library</span>
          </button>
          <button
            className={activeNav === 'Learning Paths' ? 'mobile-bottom-active' : ''}
            onClick={() => selectNav('Learning Paths')}
          >
            <ListChecks size={17} />
            <span>Paths</span>
          </button>
          <button className={activeNav === 'Notes' ? 'mobile-bottom-active' : ''} onClick={() => selectNav('Notes')}>
            <FileText size={17} />
            <span>Second Brain</span>
          </button>
          <button onClick={() => openNoemaPanel()}>
            <Sparkles size={17} />
            <span>Noema</span>
          </button>
        </nav>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          onChange={handleImport}
        />
        <input
          ref={backupInput}
          className="visually-hidden"
          type="file"
          accept=".zip,application/zip"
          onChange={handleBackupImport}
        />
        {selectionOffer && !overlay ? (
          <div
            className="selection-action"
            style={{ top: selectionOffer.top, left: selectionOffer.left }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              onClick={() => {
                openNotePanel(selectionOffer.text, 'highlight')
                setSelectionOffer(null)
              }}
            >
              <Highlighter size={14} /> Highlight
            </button>
            <button
              onClick={() => {
                openNotePanel(selectionOffer.text, 'note')
                setSelectionOffer(null)
              }}
            >
              <FileText size={14} /> Note
            </button>
            <button
              onClick={() => {
                openNotePanel(selectionOffer.text, 'question')
                setSelectionOffer(null)
              }}
            >
              <MessageCircleQuestion size={14} /> Question
            </button>
            <button
              onClick={() => {
                openNotePanel(selectionOffer.text, 'reflect')
                setSelectionOffer(null)
              }}
            >
              <Lightbulb size={14} /> Reflect
            </button>
            <button
              onClick={() => {
                openNotePanel(selectionOffer.text, 'connect')
                setSelectionOffer(null)
              }}
            >
              <Link2 size={14} /> Connect
            </button>
          </div>
        ) : null}
        {overlay === 'brain' ? (
          <BrainOverlay
            notes={notes}
            draft={noteDraft}
            setDraft={setNoteDraft}
            onClose={() => setOverlay(null)}
            onSave={saveNote}
            onOpenNote={openNoteLocation}
          />
        ) : null}
        {overlay === 'noema' ? (
          <NoemaOverlay
            context={tutorContext}
            prompt={tutorPrompt}
            reply={tutorReply}
            busy={tutorBusy}
            setPrompt={setTutorPrompt}
            onAsk={askNoema}
            onClose={() => setOverlay(null)}
          />
        ) : null}
        {utilityOverlay === 'calendar' ? <CalendarOverlay now={now} onClose={() => setUtilityOverlay(null)} /> : null}
        {utilityOverlay === 'weather' ? (
          <WeatherOverlay
            settings={weatherSettings}
            temperature={weatherTemperature}
            onSave={(next) => {
              setWeatherSettings(next)
              writeWeatherSettings(next)
              setUtilityOverlay(null)
            }}
            onClose={() => setUtilityOverlay(null)}
          />
        ) : null}
        {notice ? (
          <div className="toast-notice">
            <Sparkles size={15} /> {notice}
          </div>
        ) : null}
      </main>
      {activeNav !== 'Read' ? (
        <DesktopContextSidebar
          now={now}
          notes={notes}
          focus={focusState}
          remaining={focusRemaining}
          weather={weatherSettings}
          weatherTemperature={weatherTemperature}
          onOpenNotes={() => setOverlay('brain')}
          onOpenFocus={() => selectNav('Focus')}
          onToggleFocus={focusState.running ? pauseFocusTimer : startFocusTimer}
          onToggleTask={toggleFocusTask}
          onOpenCalendar={() => setUtilityOverlay('calendar')}
          onOpenWeather={() => setUtilityOverlay('weather')}
        />
      ) : null}
    </div>
  )
}

function FocusHomeWidget({
  focus,
  remaining,
  onOpen,
  onToggle,
}: {
  focus: FocusState
  remaining: number
  onOpen: () => void
  onToggle: () => void
}) {
  const completed = focus.tasks.filter((task) => task.done).length
  return (
    <section className="focus-home-widget panel-card">
      <button className="focus-home-main" onClick={onOpen}>
        <div>
          <p className="eyebrow">Today’s focus</p>
          <h3>{focus.title}</h3>
          <span>
            {completed} of {focus.tasks.length} steps complete
          </span>
        </div>
        <strong>{formatTimer(remaining)}</strong>
      </button>
      <div className="focus-home-actions">
        <button className="primary-button" onClick={onToggle}>
          {focus.running ? <Pause size={14} /> : <Play size={14} />}
          {focus.running ? 'Pause timer' : remaining < focus.durationMinutes * 60 ? 'Resume timer' : 'Start timer'}
        </button>
        <button className="secondary-button" onClick={onOpen}>
          Open focus <ArrowRight size={14} />
        </button>
      </div>
    </section>
  )
}

function CalendarOverlay({ now, onClose }: { now: Date; onClose: () => void }) {
  const [viewDate, setViewDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  return (
    <div className="utility-backdrop" data-overlay onMouseDown={onClose}>
      <section className="utility-panel calendar-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="utility-panel-head">
          <div>
            <p className="eyebrow">Reading calendar</p>
            <h2>{viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close calendar">
            <X size={18} />
          </button>
        </div>
        <div className="calendar-toolbar">
          <button
            className="icon-button"
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            aria-label="Previous month"
          >
            <ArrowLeft size={15} />
          </button>
          <button className="text-button" onClick={() => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1))}>
            Today
          </button>
          <button
            className="icon-button"
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            aria-label="Next month"
          >
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="calendar-grid calendar-weekdays">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid calendar-days">
          {Array.from({ length: firstDay }, (_, index) => (
            <span className="calendar-day calendar-day-empty" key={`empty-${index}`} />
          ))}
          {Array.from({ length: days }, (_, index) => {
            const day = index + 1
            const key = `${year}-${month}-${day}`
            return (
              <button
                key={key}
                className={`calendar-day ${key === todayKey ? 'calendar-day-today' : ''}`}
                onClick={onClose}
              >
                {day}
              </button>
            )
          })}
        </div>
        <p className="utility-panel-footnote">Use your focus page to set a reading session for today.</p>
      </section>
    </div>
  )
}

function WeatherOverlay({
  settings,
  temperature,
  onSave,
  onClose,
}: {
  settings: WeatherSettings
  temperature: number | null
  onSave: (settings: WeatherSettings) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(settings)
  return (
    <div className="utility-backdrop" data-overlay onMouseDown={onClose}>
      <section className="utility-panel weather-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="utility-panel-head">
          <div>
            <p className="eyebrow">Reading weather</p>
            <h2>{weatherLabel(temperature ?? 56, draft.unit)}</h2>
            <span className="utility-muted">{draft.location || 'Your reading retreat'}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close weather">
            <X size={18} />
          </button>
        </div>
        <div className="weather-current">
          <CloudSun size={32} />
          <div>
            <strong>Quiet skies</strong>
            <span>Set your preferred place and units for this sidebar.</span>
          </div>
        </div>
        <label>
          Location
          <input
            value={draft.location}
            onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
            placeholder="City or reading retreat"
          />
        </label>
        <label>
          Temperature units
          <select
            value={draft.unit}
            onChange={(event) =>
              setDraft((current) => ({ ...current, unit: event.target.value as WeatherSettings['unit'] }))
            }
          >
            <option value="F">Fahrenheit</option>
            <option value="C">Celsius</option>
          </select>
        </label>
        <button className="primary-button" onClick={() => onSave(draft)}>
          <Settings size={15} /> Save weather settings
        </button>
      </section>
    </div>
  )
}

function DesktopContextSidebar({
  now,
  notes,
  focus,
  remaining,
  weather,
  weatherTemperature,
  onOpenNotes,
  onOpenFocus,
  onToggleFocus,
  onToggleTask,
  onOpenCalendar,
  onOpenWeather,
}: {
  now: Date
  notes: Note[]
  focus: FocusState
  remaining: number
  weather: WeatherSettings
  weatherTemperature: number | null
  onOpenNotes: () => void
  onOpenFocus: () => void
  onToggleFocus: () => void
  onToggleTask: (index: number) => void
  onOpenCalendar: () => void
  onOpenWeather: () => void
}) {
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)
  const highlights = notes.filter((note) => note.kind === 'highlight').slice(0, 3)
  const questions = notes.filter((note) => note.kind === 'question').length
  const reflections = notes.filter((note) => note.kind === 'idea' || note.kind === 'connection').length
  return (
    <aside className="desktop-context-sidebar" aria-label="Daily reading context">
      <div className="context-date-row">
        <button className="context-date-button" onClick={onOpenCalendar} aria-label="Open calendar">
          <CalendarDays size={12} /> {dateLabel}
        </button>
        <button className="context-weather-button" onClick={onOpenWeather} aria-label="Open weather settings">
          <CloudSun size={14} /> {weatherLabel(weatherTemperature ?? 56, weather.unit)}
        </button>
      </div>
      <section className="context-section context-focus">
        <div className="context-section-heading">
          <button className="context-heading-button" onClick={onOpenFocus}>
            <h2>{focus.title}</h2>
            <ArrowRight size={12} />
          </button>
          <button className="context-more-button" onClick={onOpenFocus} aria-label="Open focus settings">
            <MoreVertical size={14} />
          </button>
        </div>
        <p className="context-intro">Make reading part of the day, one quiet session at a time.</p>
        <div className="focus-list">
          {focus.tasks.map((task, index) => (
            <button
              key={`${task.label}-${index}`}
              className={task.done ? 'focus-item focus-item-done' : 'focus-item'}
              onClick={() => onToggleTask(index)}
            >
              {task.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              <span>{task.label}</span>
            </button>
          ))}
        </div>
        <div className="context-focus-timer">
          <span>
            {focus.running
              ? `Focus running · ${formatTimer(remaining)}`
              : remaining < focus.durationMinutes * 60
                ? `Paused · ${formatTimer(remaining)}`
                : `${focus.durationMinutes} minute timer`}
          </span>
          <button onClick={onToggleFocus}>
            {focus.running ? <Pause size={12} /> : <Play size={12} />}
            {focus.running ? 'Pause' : 'Start'}
          </button>
        </div>
      </section>
      <section className="context-section">
        <div className="context-section-heading">
          <h2>Recent highlights</h2>
          <button onClick={onOpenNotes}>
            View all <ArrowRight size={12} />
          </button>
        </div>
        {highlights.length > 0 ? (
          <div className="context-highlight-list">
            {highlights.map((note) => (
              <article key={note.id}>
                <Highlighter size={12} />
                <div>
                  <p>{note.body}</p>
                  <small>{note.source}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="context-empty">Highlights from your reading will appear here.</p>
        )}
      </section>
      <section className="context-section context-brain">
        <div className="context-section-heading">
          <h2>Your Second Brain</h2>
          <button onClick={onOpenNotes}>
            Open <ArrowRight size={12} />
          </button>
        </div>
        <p className="context-intro">Your highlights, notes, and connections in one place.</p>
        <div className="context-metrics">
          <div>
            <strong>{notes.length}</strong>
            <span>Notes</span>
          </div>
          <div>
            <strong>{highlights.length}</strong>
            <span>Highlights</span>
          </div>
          <div>
            <strong>{questions + reflections}</strong>
            <span>Ideas</span>
          </div>
        </div>
        {notes[0] ? (
          <div className="context-quote">
            <QuoteMark />
            <p>
              “{notes[0].body.slice(0, 96)}
              {notes[0].body.length > 96 ? '…' : ''}”
            </p>
            <small>{notes[0].source}</small>
          </div>
        ) : null}
      </section>
    </aside>
  )
}
function QuoteMark() {
  return (
    <span className="context-quote-mark" aria-hidden="true">
      “
    </span>
  )
}
function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="page-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Noesis</p>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  )
}
function SuggestedSection({ resources, onExplore }: { resources: Resource[]; onExplore: () => void }) {
  return (
    <section className="section-block suggested-section">
      <div className="section-heading">
        <div>
          <h2>Suggested for you</h2>
          <p>
            {resources.length
              ? 'Based on your latest search.'
              : 'Search books, journals, and research for your next idea.'}
          </p>
        </div>
        <button className="text-button" onClick={onExplore}>
          Explore <ArrowRight size={15} />
        </button>
      </div>
      {resources.length === 0 ? (
        <button className="suggested-empty panel-card" onClick={onExplore}>
          <Search size={18} />
          <span>Find a book, article, or journal</span>
          <ArrowRight size={16} />
        </button>
      ) : (
        <div className="suggested-grid">
          {resources.slice(0, 5).map((resource) => (
            <button className="suggested-card" key={`${resource.source}-${resource.id}`} onClick={onExplore}>
              <div className="suggested-cover">
                {resource.coverUrl ? (
                  <img src={resource.coverUrl} alt="" />
                ) : resource.kind === 'article' ? (
                  <FileText size={19} />
                ) : (
                  <BookOpen size={19} />
                )}
              </div>
              <strong>{resource.title}</strong>
              <span>{resource.author}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
function BookSection({
  books,
  onOpen,
  onImport,
  onDelete,
}: {
  books: LibraryBook[]
  onOpen: (book: LibraryBook) => void
  onImport?: () => void
  onDelete?: (book: LibraryBook) => void
}) {
  return (
    <section className="section-block library-section">
      <div className="section-heading">
        <div>
          <h2>My library</h2>
          <p>Local books, articles, and reading sources.</p>
        </div>
        {onImport ? (
          <button className="text-button" onClick={onImport}>
            Import <Upload size={14} />
          </button>
        ) : null}
      </div>
      {books.length === 0 ? (
        <div className="empty-state">No books here yet. Import an EPUB or search Explore for a free resource.</div>
      ) : (
        <div className="book-grid">
          {books.map((book) => (
            <div className="book-card-wrap" key={book.id}>
              <button className="book-card" onClick={() => onOpen(book)}>
                <div className="book-card-cover">
                  <BookCover book={book} compact />
                  <ProgressRing value={book.progress} />
                  {book.accessType === 'borrow' ? (
                    <span className="book-card-badge">Borrowed</span>
                  ) : book.format === 'resource' ? (
                    <span className="book-card-badge">Source</span>
                  ) : null}
                </div>
                <div className="book-card-title">{book.title}</div>
                <div className="book-card-author">{book.author}</div>
              </button>
              {onDelete ? (
                <button className="book-delete" onClick={() => onDelete(book)} aria-label={`Remove ${book.title}`}>
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card panel-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}
function ReadingShelfSection({
  books,
  onOpen,
  onImport,
}: {
  books: LibraryBook[]
  onOpen: (book: LibraryBook) => void
  onImport: () => void
}) {
  return (
    <section className="section-block shelf-section">
      <div className="section-heading">
        <div>
          <h2>Recently reading</h2>
          <p>A quiet shelf for the books you are spending time with.</p>
        </div>
        <button className="text-button" onClick={onImport}>
          Add book <Plus size={14} />
        </button>
      </div>
      {books.length === 0 ? (
        <button className="empty-state" onClick={onImport}>
          Your shelf is waiting for its first book.
        </button>
      ) : (
        <div className="bookshelf-row">
          {books.map((book) => (
            <button className="shelf-book" key={book.id} onClick={() => onOpen(book)}>
              <div className="shelf-cover">
                <BookCover book={book} compact />
                <span className="shelf-progress" style={{ width: `${Math.max(4, book.progress)}%` }} />
              </div>
              <strong>{book.title}</strong>
              <span>{book.author}</span>
              <small>{Math.round(book.progress)}% read</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
function PathSection({
  paths,
  books,
  onOpen,
  editable = false,
  onDelete,
  onAssign,
}: {
  paths: LearningPath[]
  books: LibraryBook[]
  onOpen?: () => void
  editable?: boolean
  onDelete?: (id: string) => void
  onAssign?: (pathId: string, bookId: string) => void
}) {
  return (
    <section className="section-block path-section">
      <div className="section-heading">
        <div>
          <h2>Learning paths</h2>
          <p>Journeys that connect books around one question or goal.</p>
        </div>
        {onOpen ? (
          <button className="text-button" onClick={onOpen}>
            View all <ArrowRight size={15} />
          </button>
        ) : null}
      </div>
      {paths.length === 0 ? (
        <div className="empty-state">Create a path when you want to connect several books around one goal.</div>
      ) : (
        <div className="journey-list">
          {paths.map((path) => {
            const pathBooks = books.filter((book) => path.bookIds.includes(book.id))
            const progress = pathBooks.length
              ? Math.round(pathBooks.reduce((sum, book) => sum + book.progress, 0) / pathBooks.length)
              : 0
            return (
              <article className="journey-item" key={path.id}>
                <div className="journey-marker">
                  <Brain size={15} />
                </div>
                <div className="journey-content">
                  <div className="journey-line">
                    <strong>{path.title}</strong>
                    <span>{progress}%</span>
                  </div>
                  <div className="journey-track">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <p>{path.description}</p>
                  <small>
                    {pathBooks.length} {pathBooks.length === 1 ? 'book' : 'books'} ·{' '}
                    {progress >= 100 ? 'Complete' : 'In progress'}
                  </small>
                  {editable && books.length > 0 ? (
                    <select
                      className="path-book-select"
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value) onAssign?.(path.id, event.target.value)
                        event.target.value = ''
                      }}
                    >
                      <option value="">Add a book…</option>
                      {books
                        .filter((book) => !path.bookIds.includes(book.id))
                        .map((book) => (
                          <option key={book.id} value={book.id}>
                            {book.title}
                          </option>
                        ))}
                    </select>
                  ) : null}
                </div>
                {editable ? (
                  <button
                    className="path-delete"
                    onClick={() => onDelete?.(path.id)}
                    aria-label={`Delete ${path.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
function NotesSection({
  notes,
  expanded = false,
  onOpen,
  onOpenNote,
}: {
  notes: Note[]
  expanded?: boolean
  onOpen: (seed?: string) => void
  onOpenNote?: (note: Note) => void
}) {
  return (
    <section className="section-block notes-section">
      <div className="section-heading">
        <div>
          <h2>My notes</h2>
          <p>Highlights and ideas worth returning to.</p>
        </div>
        <button className="text-button" onClick={() => onOpen()}>
          Add note <Plus size={14} />
        </button>
      </div>
      {notes.length === 0 ? (
        <div className="empty-state">Select text anywhere or add a note to start your Second Brain.</div>
      ) : (
        <div className="notes-grid">
          {notes.slice(0, expanded ? 100 : 6).map((note) => (
            <article key={note.id} className={`note-card note-${note.kind}`}>
              <div className="note-icon">
                {note.kind === 'highlight' ? (
                  <Highlighter size={16} />
                ) : note.kind === 'idea' ? (
                  <Sparkles size={16} />
                ) : note.kind === 'connection' ? (
                  <Link2 size={16} />
                ) : (
                  <CircleHelp size={16} />
                )}
              </div>
              <p>{note.body}</p>
              <span>
                {note.bookTitle
                  ? `${note.bookTitle}${note.chapter ? ` · ${note.chapter}` : ''}${note.page ? ` · p. ${note.page}` : ''}`
                  : note.source}
              </span>
              <div className="note-footer">
                <em>{note.title}</em>
                <button
                  className="icon-button tiny"
                  onClick={() => (note.bookId && onOpenNote ? onOpenNote(note) : onOpen(note.body))}
                  aria-label={note.bookId ? 'Open in book' : 'Open note'}
                >
                  {note.bookId ? <BookOpen size={15} /> : <MoreVertical size={15} />}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
function BrainOverlay({
  notes,
  draft,
  setDraft,
  onClose,
  onSave,
  onOpenNote,
}: {
  notes: Note[]
  draft: NoteDraft
  setDraft: React.Dispatch<React.SetStateAction<NoteDraft>>
  onClose: () => void
  onSave: (event: React.FormEvent<HTMLFormElement>) => void
  onOpenNote: (note: Note) => void
}) {
  const [filter, setFilter] = useState<'all' | BrainNoteKind>('all')
  const labels: Array<{ id: 'all' | BrainNoteKind; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'highlight', label: 'Highlights' },
    { id: 'note', label: 'Notes' },
    { id: 'idea', label: 'Ideas' },
    { id: 'question', label: 'Questions' },
    { id: 'connection', label: 'Connections' },
  ]
  const filtered = filter === 'all' ? notes : notes.filter((note) => note.kind === filter)
  return (
    <div className="brain-backdrop" data-overlay onMouseDown={onClose}>
      <section className="brain-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="brain-panel-head">
          <div>
            <p className="eyebrow">Second Brain</p>
            <h2>Keep what matters</h2>
            <p>Separate highlights, notes, ideas, and questions without losing their source.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close Second Brain">
            <X size={18} />
          </button>
        </div>
        <form className="brain-form" onSubmit={onSave}>
          <label>
            Capture as
            <select
              value={draft.kind}
              onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value as BrainNoteKind }))}
            >
              <option value="highlight">Highlight</option>
              <option value="note">Note</option>
              <option value="question">Question</option>
              <option value="idea">Reflection</option>
              <option value="connection">Connection</option>
            </select>
          </label>
          <label>
            Title
            <input
              value={draft.title}
              onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              placeholder="Quick note"
            />
          </label>
          <label>
            Note
            <textarea
              value={draft.body}
              onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))}
              placeholder="Write an idea, question, or highlighted passage…"
              rows={5}
            />
          </label>
          <label>
            {draft.location?.bookId ? 'Detected source' : 'Source'}
            <input
              value={draft.source}
              onChange={(event) => setDraft((value) => ({ ...value, source: event.target.value }))}
              placeholder="Book, chapter, or link"
              readOnly={Boolean(draft.location?.bookId)}
            />
          </label>
          {draft.location?.bookId ? (
            <p className="brain-source-hint">
              This location is captured automatically from the open reader. Clicking the saved item will return here.
            </p>
          ) : null}
          <button className="primary-button" type="submit">
            <Plus size={16} /> Save to Second Brain
          </button>
        </form>
        <div className="brain-list">
          <div className="brain-list-heading">
            <h3>Knowledge shelf</h3>
            <span>{filtered.length}</span>
          </div>
          <div className="brain-filter-row" role="tablist" aria-label="Second Brain sections">
            {labels.map((item) => (
              <button
                key={item.id}
                className={filter === item.id ? 'brain-filter-active' : ''}
                onClick={() => setFilter(item.id)}
                role="tab"
                aria-selected={filter === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
          {filtered.length > 0 ? (
            filtered.slice(0, 40).map((note) => (
              <article className="brain-list-item" key={note.id}>
                <div>
                  <strong>{note.title}</strong>
                  <p>{note.body}</p>
                  <small>
                    {note.bookTitle
                      ? `${note.bookTitle}${note.chapter ? ` · ${note.chapter}` : ''}${note.page ? ` · p. ${note.page}` : ''}`
                      : note.source}
                  </small>
                  <div className="brain-list-actions">
                    {note.bookId ? (
                      <button className="brain-open-note" onClick={() => onOpenNote(note)}>
                        <BookOpen size={11} /> Open in book
                      </button>
                    ) : null}
                    <span className={note.synced ? 'sync-state synced' : 'sync-state'}>
                      {note.synced ? 'Synced' : 'Local'}
                    </span>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <p className="brain-rail-empty">Nothing saved in this section yet.</p>
          )}
        </div>
      </section>
    </div>
  )
}
function NoemaOverlay({
  context,
  prompt,
  reply,
  busy,
  setPrompt,
  onAsk,
  onClose,
}: {
  context: ReaderTutorContext | null
  prompt: string
  reply: string
  busy: boolean
  setPrompt: (value: string) => void
  onAsk: TutorHandler
  onClose: () => void
}) {
  const location = context
    ? [context.chapter, context.page ? `p. ${context.page}` : ''].filter(Boolean).join(' · ')
    : ''
  const hasPassage = Boolean(context?.selectedText || context?.visibleText)
  const explainPrompt = context?.selectedText ? 'Explain the selected passage' : 'Explain the current page'
  return (
    <div className="brain-backdrop" data-overlay onMouseDown={onClose}>
      <section className="noema-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="brain-panel-head">
          <div>
            <p className="eyebrow">Noema</p>
            <h2>Your learning guide</h2>
            <p>
              {hasPassage
                ? 'This conversation is grounded in the passage you are reading.'
                : 'Ask about your book or notes. Paste a borrowed passage when you need a precise explanation.'}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close Noema">
            <X size={18} />
          </button>
        </div>
        {context ? (
          <div className="noema-reader-context">
            <BookOpen size={15} />
            <span>
              <strong>{hasPassage ? 'Reading context' : 'Book context'}</strong>
              <small>
                {context.bookTitle}
                {location ? ` · ${location}` : ''}
              </small>
            </span>
          </div>
        ) : null}
        <div className="noema-orb">
          <Sparkles size={24} />
        </div>
        <div className="tutor-chips">
          <button onClick={() => onAsk(explainPrompt)}>
            {context?.selectedText
              ? 'Explain this passage'
              : context?.visibleText
                ? 'Explain this page'
                : 'Explain this book'}
          </button>
          <button onClick={() => onAsk('Summarize the ideas on this page')}>Summarize this page</button>
          <button onClick={() => onAsk('Test my understanding of what I am reading')}>Test my understanding</button>
          <button onClick={() => onAsk('Connect this passage to my saved notes')}>Connect to my notes</button>
        </div>
        <div className="noema-input">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onAsk(prompt)
              }
            }}
            placeholder="Ask about the page, passage, or book…"
            rows={3}
          />
          <button className="primary-button" onClick={() => onAsk(prompt)} disabled={busy}>
            {busy ? 'Thinking…' : 'Ask Noema'}
          </button>
        </div>
        {reply ? (
          <div className="tutor-reply">
            <strong>{prompt}</strong>
            <p>{reply}</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export default App
