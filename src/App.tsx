import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Brain,
  Compass,
  Cpu,
  FlaskConical,
  Landmark,
  Target,
  CheckCircle2,
  CircleHelp,
  Cloud,
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
import { SettingsPage } from './SettingsPage'
import type { SettingsSectionId } from './settings/sections'
import { Group, Row, Toggle } from './settings/controls'
import { ContextSidebar } from './ContextSidebar'
import { FreeCopyContext } from './lib/freeCopy'
import { PathPlanDetail, PathPlanner } from './PathPlanner'
import { planProgress, type LearningPath } from './lib/pathPlan'
import { CalendarPanel } from './CalendarPanel'
import { WeatherPanel } from './WeatherPanel'
import {
  addFocusTask,
  focusRemainingSeconds,
  formatTimer,
  readFocusState,
  removeFocusTask,
  writeFocusState,
  type FocusState,
} from './lib/focus'
import { readEvents, toggleDone, writeEvents, type CalendarEvent } from './lib/calendar'
import { applyFocusSync, focusToSync, sameItems, type SyncBundle } from './lib/syncData'
import { readWeatherSettings, writeWeatherSettings, type WeatherSettings } from './lib/weather'
import { timeAgo } from './lib/time'
import { readSettings, rootAppearance, writeSettings, type Settings as AppSettings } from './lib/settings'
import { dueCards, readReviewCards, writeReviewCards } from './lib/review'
import { markDeleted, markRemoved, markRestored } from './lib/tombstones'
import { retrievedContext } from './lib/retrieval'
import { syncAccountBundle, syncAccountLibrary } from './lib/accountLibrary'
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
import { syncCloudState, type CloudSyncState } from './lib/cloudSync'
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
type UtilityOverlay = 'calendar' | 'weather' | null

const PATHS_KEY = 'noesis:paths:v1'
const PROFILE_NAME_KEY = 'noesis:profile:first-name:v1'
const navItems = [
  { label: 'Home', text: 'Home', icon: Home },
  { label: 'My Library', text: 'Library', icon: Library },
  { label: 'Notes', text: 'Second Brain', icon: Brain },
  { label: 'Review', text: 'Review', icon: RotateCcw },
  { label: 'Learning Paths', text: 'Paths', icon: ListChecks },
  { label: 'Explore', text: 'Explore', icon: Search },
  { label: 'Settings', text: 'Settings', icon: Settings },
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
  // Traced from the Noesis logo artwork: an open book with an olive branch.
  return (
    <svg className="noesis-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        fill="var(--mark-accent, #d5ab61)"
        fillRule="evenodd"
        d="M31.03 53.39C30.44 53.27 30.19 53.11 29.47 52.33C29.22 52.05 29.14 52.01 28.12 51.57C24.18 49.90 20.27 49.35 14.79 49.70C14.06 49.74 13.34 49.80 13.20 49.83C13.05 49.86 12.63 49.92 12.26 49.96C11.89 50.01 11.38 50.09 11.12 50.15C10.19 50.35 9.68 50.24 9.58 49.79C9.57 49.71 9.54 45.14 9.53 39.64C9.52 34.14 9.49 29.31 9.47 28.90C9.38 26.82 9.39 26.81 11.47 26.40C12.90 26.12 12.82 26.20 12.78 25.15C12.77 24.72 12.72 24.16 12.69 23.89C12.54 22.75 12.58 22.73 15.12 22.41C15.70 22.33 16.44 22.24 16.76 22.20C20.02 21.76 24.10 22.31 26.49 23.51C27.97 24.25 30.11 26.00 30.51 26.80C30.58 26.93 30.81 27.26 31.03 27.53C31.57 28.21 31.72 28.24 32.04 27.69C32.13 27.53 32.39 27.23 32.62 27.01C32.85 26.79 33.22 26.37 33.43 26.08C34.03 25.30 34.71 24.72 35.57 24.24C36.14 23.93 37.40 23.34 37.74 23.23C39.42 22.69 39.55 22.61 39.61 21.96C39.71 21.01 40.12 19.99 40.41 19.99C40.71 19.99 41.66 20.94 41.99 21.57C42.40 22.37 42.74 22.34 43.46 21.44C44.42 20.24 44.47 20.07 44.10 18.95C43.86 18.21 43.79 17.26 43.93 16.57C43.98 16.34 44.02 16.06 44.02 15.95C44.02 15.23 44.40 14.71 45.05 14.51C45.26 14.45 45.58 14.35 45.75 14.29C46.38 14.10 46.51 14.23 46.70 15.26C46.98 16.70 46.80 17.85 46.18 18.78C45.86 19.25 45.97 19.32 46.54 19.00C47.42 18.52 48.32 18.39 49.25 18.60C50.18 18.82 50.19 18.90 49.41 20.08C48.57 21.36 47.24 21.91 45.74 21.58C45.16 21.46 44.92 21.47 44.73 21.65C44.40 21.95 44.59 22.05 45.65 22.12C46.50 22.17 47.20 22.27 48.81 22.55C50.43 22.83 50.38 22.76 50.38 24.62C50.38 26.19 50.38 26.18 50.70 26.24C50.86 26.27 51.51 26.37 51.89 26.43C52.69 26.55 53.31 26.75 53.50 26.94C53.67 27.12 53.67 27.12 53.66 38.27C53.65 44.89 53.62 49.51 53.59 49.62C53.45 50.17 52.97 50.30 51.81 50.10C51.46 50.04 51.01 49.98 50.80 49.96C50.60 49.94 50.06 49.88 49.61 49.83C44.38 49.19 39.00 49.82 35.22 51.50C33.99 52.05 33.88 52.11 33.41 52.54C32.63 53.27 31.85 53.54 31.03 53.39ZM35.24 49.45C36.41 48.96 37.80 48.54 39.34 48.21C39.68 48.14 40.23 48.02 40.56 47.95C40.90 47.88 41.37 47.80 41.60 47.78C42.22 47.73 42.43 47.68 43.20 47.39C44.04 47.07 45.38 46.86 45.96 46.95C46.14 46.98 46.56 47.04 46.89 47.08C48.52 47.31 48.62 47.33 48.82 47.46C49.37 47.83 51.66 48.25 51.79 48.02C51.90 47.80 51.89 28.32 51.78 28.13C51.68 27.97 50.98 27.70 50.66 27.70C50.29 27.70 50.28 27.82 50.28 38.58C50.27 46.54 50.27 46.54 50.05 46.75C49.74 47.03 49.42 47.03 47.98 46.73C47.78 46.68 47.49 46.62 47.35 46.59C47.20 46.56 46.66 46.50 46.15 46.45C45.64 46.40 44.97 46.34 44.66 46.31C41.39 46.00 38.06 46.85 35.56 48.64C34.13 49.66 34.01 49.96 35.24 49.45ZM28.48 49.56C28.58 49.46 28.48 49.34 27.91 48.91C24.35 46.19 20.05 45.54 13.98 46.82C12.81 47.07 12.88 47.34 12.87 42.34C12.86 36.50 12.84 36.18 12.50 35.74C12.26 35.43 12.26 35.23 12.50 34.94C12.82 34.56 12.82 34.60 12.84 31.24C12.86 27.47 12.91 27.71 12.08 27.92C11.24 28.13 11.25 28.04 11.42 33.69C11.45 34.73 11.44 35.92 11.41 36.93C11.31 39.88 11.37 47.93 11.49 48.07C11.62 48.22 12.11 48.22 12.92 48.08C14.88 47.73 18.39 47.60 20.51 47.80C20.82 47.83 21.36 47.88 21.71 47.91C22.06 47.94 22.42 47.99 22.52 48.02C22.62 48.04 22.93 48.09 23.21 48.13C24.67 48.30 26.54 48.80 27.88 49.40C28.42 49.64 28.39 49.64 28.48 49.56ZM30.48 48.74C30.56 48.66 30.56 48.16 30.52 43.70C30.48 38.16 30.48 36.92 30.50 35.41C30.56 32.25 30.49 29.93 30.34 29.61C28.97 26.68 25.26 24.50 20.85 24.03C18.91 23.82 15.16 24.16 14.86 24.56C14.69 24.80 14.69 44.64 14.87 44.78C15.02 44.90 15.23 44.91 15.80 44.80C17.57 44.47 19.76 44.33 20.69 44.48C20.96 44.53 21.50 44.58 21.89 44.61C24.46 44.80 27.58 46.25 29.55 48.16C30.26 48.84 30.33 48.88 30.48 48.74ZM33.41 48.34C33.70 48.07 34.07 47.76 34.23 47.63C34.39 47.51 34.66 47.30 34.82 47.17C35.37 46.72 36.78 45.91 37.56 45.61C39.07 45.02 40.59 44.63 41.81 44.51C42.16 44.48 42.63 44.43 42.85 44.40C43.33 44.35 44.41 44.34 44.82 44.40C44.98 44.42 45.39 44.47 45.72 44.51C46.06 44.54 46.61 44.62 46.94 44.68C48.02 44.86 48.19 44.87 48.35 44.71C48.56 44.50 48.55 24.66 48.34 24.44C48.18 24.28 47.95 24.22 47.05 24.11C46.66 24.07 46.20 24.01 46.04 23.98C45.29 23.85 43.43 23.80 43.28 23.91C42.98 24.12 42.18 26.03 42.22 26.45C42.25 26.71 42.40 26.68 43.02 26.33C43.99 25.77 44.82 25.61 45.69 25.81C46.33 25.96 46.44 26.12 46.21 26.55C45.30 28.23 44.30 28.82 42.63 28.66C41.51 28.56 41.39 28.67 40.83 30.23C40.71 30.58 40.50 31.10 40.37 31.39C40.01 32.19 40.07 32.32 40.66 31.97C41.92 31.20 43.45 31.01 44.05 31.54C44.29 31.76 44.30 31.74 43.79 32.50C42.77 34.01 41.64 34.50 40.13 34.11C39.36 33.91 39.37 33.91 38.49 34.86C37.74 35.67 37.27 36.10 36.41 36.73C35.25 37.60 33.93 39.19 33.28 40.52C32.62 41.87 32.58 42.19 32.55 45.61C32.53 49.30 32.48 49.17 33.41 48.34ZM33.03 38.17C33.11 38.08 33.21 37.95 33.25 37.87C33.36 37.66 34.94 36.18 35.41 35.85C36.19 35.30 36.88 34.74 37.34 34.31C37.60 34.07 37.83 33.87 37.86 33.87C37.95 33.87 38.93 32.32 39.11 31.90C39.60 30.74 39.57 30.41 38.94 30.07C37.57 29.32 37.06 28.11 37.45 26.49C37.64 25.68 37.85 25.60 38.52 26.06C39.34 26.64 39.81 27.24 39.98 27.94C40.12 28.52 40.28 28.63 40.47 28.30C40.75 27.82 41.31 25.93 41.31 25.45C41.31 25.22 40.45 24.30 40.23 24.30C40.05 24.30 39.53 24.45 38.99 24.66C38.70 24.78 38.24 24.96 37.96 25.07C37.39 25.29 37.40 25.28 36.23 26.02C34.83 26.90 33.38 28.40 32.81 29.56C32.61 29.96 32.61 29.96 32.60 34.04C32.59 36.83 32.60 38.16 32.64 38.24C32.72 38.39 32.87 38.36 33.03 38.17Z"
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
  const [settings, setSettings] = useState<AppSettings>(() => readSettings())
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('account')
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    try {
      return localStorage.getItem('noesis:last-sync') ?? ''
    } catch {
      return ''
    }
  })
  const [activeNav, setActiveNav] = useState('Home')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySort, setLibrarySort] = useState<LibrarySort>(() => settings.library.defaultSort)
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
  const [events, setEvents] = useState<CalendarEvent[]>(() => readEvents())
  // dataVersion bumps when review cards change on this device (to trigger a sync);
  // reviewRemount bumps when a sync brought in different cards (to refresh the page).
  const [dataVersion, setDataVersion] = useState(0)
  const [reviewRemount, setReviewRemount] = useState(0)
  const [calendarSeed, setCalendarSeed] = useState<{ date?: string; adding?: boolean }>({})
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
  // Brings calendar, focus steps and review cards from a sync into this device.
  // It only touches state when the items really differ, so a sync that changed
  // nothing never re-renders or restarts anything.
  const applyBundle = useCallback((bundle: SyncBundle) => {
    setEvents((current) => {
      if (sameItems(current, bundle.events)) return current
      writeEvents(bundle.events)
      return bundle.events
    })
    setFocusState((current) => applyFocusSync(current, bundle.focus))
    const incomingPaths = bundle.paths
    if (incomingPaths) {
      setPaths((current) => {
        if (sameItems(current, incomingPaths)) return current
        writePaths(incomingPaths)
        return incomingPaths
      })
    }
    if (!sameItems(readReviewCards(), bundle.cards)) {
      writeReviewCards(bundle.cards)
      setReviewRemount((value) => value + 1)
    }
  }, [])
  const focusSignature = JSON.stringify(focusToSync(focusState))
  useEffect(() => {
    if (!authUser || isAnonymousUser(authUser) || !settings.backup.autoSync) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const merged = await syncAccountBundle({
          events,
          cards: readReviewCards(),
          focus: focusToSync(focusState),
          paths,
        })
        if (cancelled) return
        applyBundle(merged)
        markSynced()
      } catch {
        // Book sync reports storage problems; a failed background sync of the
        // calendar just retries on the next change or with Sync now.
      }
    }, 1500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // focusState is read through focusSignature so timer ticks do not trigger a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, events, paths, focusSignature, dataVersion, settings.backup.autoSync, applyBundle])
  // Review cards live in local storage; recount whenever the page changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dueCount = useMemo(() => dueCards(readReviewCards()).length, [activeNav, dataVersion, reviewRemount])
  useEffect(() => {
    const root = document.documentElement
    const { classes, vars } = rootAppearance(settings)
    for (const name of ['no-scenery', 'reduce-motion', 'compact']) root.classList.toggle(name, classes.includes(name))
    for (const key of [
      '--gold-warm',
      '--gold-soft',
      '--accent-light',
      '--accent-fill',
      '--accent-border',
      '--accent-hover',
      '--accent-rgb',
      '--accent-mark',
    ]) {
      root.style.removeProperty(key)
    }
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  }, [settings])
  useEffect(() => {
    const count = dueCount
    if (!settings.notifications.reviewReminders || count === 0) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const today = new Date().toDateString()
    try {
      if (localStorage.getItem('noesis:review-notified') === today) return
      localStorage.setItem('noesis:review-notified', today)
    } catch {
      return
    }
    new Notification('Noesis', {
      body: `${count} review ${count === 1 ? 'card is' : 'cards are'} ready.`,
      icon: '/icons/icon-192.png',
    })
  }, [dueCount, settings.notifications.reviewReminders])
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
    if (!authUser || isAnonymousUser(authUser) || !settings.backup.autoSync) return
    let cancelled = false
    const restore = async () => {
      try {
        const restored = await syncAccountLibrary(readLibraryBooks())
        if (!cancelled) {
          setBooks((current) =>
            JSON.stringify(current) === JSON.stringify(restored) ? current : (writeLibraryBooks(restored), restored),
          )
          markSynced()
        }
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
  }, [authUser, authUserId, settings.backup.autoSync])
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
    if (!user || isAnonymousUser(user) || !connection || !settings.backup.autoSync) {
      cloudReady.current = false
      return
    }
    let cancelled = false
    const run = async () => {
      setCloudSyncing(true)
      try {
        const merged = await syncCloudState(connection, {
          books,
          notes,
          paths,
          bundle: { events, cards: readReviewCards(), focus: focusToSync(focusState) },
        })
        if (cancelled) return
        if (merged.bundle) applyBundle(merged.bundle)
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
        markSynced()
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
    // focusState is read through focusSignature so timer ticks do not trigger a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authUserId,
    authUserRef,
    cloudConnection,
    books,
    notes,
    paths,
    events,
    focusSignature,
    dataVersion,
    settings.backup.autoSync,
    applyBundle,
  ])
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
  const closeUtility = useCallback(() => setUtilityOverlay(null), [])
  function updateEvents(next: CalendarEvent[]) {
    markRemoved('event', events, next)
    setEvents(next)
    writeEvents(next)
  }
  function updateWeather(next: WeatherSettings) {
    setWeatherSettings(next)
    writeWeatherSettings(next)
  }
  function updateSettings(next: AppSettings) {
    setSettings(next)
    writeSettings(next)
  }
  function markSynced() {
    const stamp = new Date().toISOString()
    setLastSyncedAt(stamp)
    try {
      localStorage.setItem('noesis:last-sync', stamp)
    } catch {
      // Storage can be unavailable; the time then only lasts for this session.
    }
  }
  function openSettings(section: SettingsSectionId) {
    setSettingsSection(section)
    setMobileNavOpen(false)
    setSelectedBookId(null)
    setActiveNav('Settings')
  }
  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3800)
  }
  function updateFocusState(updater: (current: FocusState) => FocusState) {
    const next = updater(focusState)
    // Removed steps are remembered so another device does not bring them back,
    // and a changed title, session name or length is stamped so the newest wins.
    markRemoved('focus', focusState.tasks, next.tasks)
    const metaChanged =
      next.title !== focusState.title ||
      next.session !== focusState.session ||
      next.durationMinutes !== focusState.durationMinutes
    setFocusState(metaChanged ? { ...next, metaUpdated: new Date().toISOString() } : next)
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
      tasks: current.tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, done: !task.done, updated: new Date().toISOString() } : task,
      ),
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
      if (settings.library.indexText && parsed?.text) await saveBookText(book.id, parsed.text)
      const nextBooks = upsertLibraryBook(book)
      setBooks(nextBooks)
      if (settings.backup.autoSync && authUser && !isAnonymousUser(authUser)) {
        void syncAccountLibrary(nextBooks)
          .then((synced) => {
            setBooks(synced)
            markSynced()
          })
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
    if (!settings.ai.enabled) {
      setTutorPrompt(question)
      setTutorReply('Noema is turned off. You can turn it back on in Settings → AI Companion.')
      return
    }
    const activeContext = readingContext ?? tutorContext
    if (readingContext) setTutorContext(readingContext)
    setTutorPrompt(question)
    setTutorReply('')
    setTutorBusy(true)
    let bookText = ''
    if (settings.ai.useReadingText && selectedBook?.format === 'epub')
      bookText = (await loadBookText(selectedBook.id).catch(() => '')) || ''
    const contextText = settings.ai.useNotes
      ? notes
          .slice(0, 30)
          .map((note) => `${note.title} (${note.source}): ${note.body}`)
          .join('\n\n')
      : ''
    const position =
      activeContext && settings.ai.useReadingText
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
        body: JSON.stringify({ question, book: bookContext, context: contextText, length: settings.ai.length }),
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
        if (settings.library.indexText && parsed?.text) await saveBookText(book.id, parsed.text)
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
      updated: new Date().toISOString(),
    }
    const next = [path, ...paths]
    setPaths(next)
    writePaths(next)
    setPathDraft({ title: '', description: '' })
    showNotice('Learning path created.')
  }
  function savePlannedPath(path: LearningPath) {
    const next = [path, ...paths]
    setPaths(next)
    writePaths(next)
  }
  function deleteBook(book: LibraryBook) {
    if (settings.library.confirmDelete && !window.confirm(`Remove ${book.title} from your library?`)) return
    setBooks(removeLibraryBook(book.id))
    if (selectedBookId === book.id) setSelectedBookId(null)
    showNotice(`${book.title} was removed.`)
  }
  function clearLocalData() {
    if (
      !window.confirm(
        'Delete all Noesis data on this device? Books, notes, review cards, and settings will be removed from this browser. Anything synced to your account or a cloud provider is kept.',
      )
    )
      return
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('noesis:')) localStorage.removeItem(key)
    } catch {
      // Nothing more to clear if storage is unavailable.
    }
    const request = indexedDB.deleteDatabase('noesis-library')
    const reload = () => window.location.assign('/')
    request.onsuccess = reload
    request.onerror = reload
    request.onblocked = reload
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
      openSettings('account')
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
      const merged = await syncCloudState(connection, {
        books,
        notes,
        paths,
        bundle: { events, cards: readReviewCards(), focus: focusToSync(focusState) },
      })
      setBooks(merged.books)
      setNotes(merged.notes)
      setPaths(merged.paths as LearningPath[])
      writeLibraryBooks(merged.books)
      writeLocalNotes(merged.notes)
      writePaths(merged.paths as LearningPath[])
      if (merged.bundle) applyBundle(merged.bundle)
      markSynced()
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
            <label className="focus-title-field">
              Session name
              <input
                value={focusState.session}
                maxLength={40}
                onChange={(event) => updateFocusState((current) => ({ ...current, session: event.target.value }))}
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
                          itemIndex === index
                            ? { ...item, label: event.target.value, updated: new Date().toISOString() }
                            : item,
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="focus-item-remove"
                    onClick={() => updateFocusState((current) => removeFocusTask(current, index))}
                    aria-label={`Remove: ${task.label}`}
                  >
                    <X size={13} />
                  </button>
                </label>
              ))}
            </div>
            <form
              className="focus-add focus-add-wide"
              onSubmit={(event) => {
                event.preventDefault()
                const field = event.currentTarget.elements.namedItem('step') as HTMLInputElement
                updateFocusState((current) => addFocusTask(current, field.value))
                field.value = ''
              }}
            >
              <input name="step" placeholder="Add a focus step" maxLength={120} aria-label="Add a focus step" />
              <button type="submit" className="secondary-button">
                <Plus size={14} /> Add
              </button>
            </form>
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
        <ReadingShelfSection books={books} onOpen={openSavedBook} onImport={() => fileInput.current?.click()} />
        <FreeCopyContext.Provider value={addResource}>
          <PathSection
            paths={paths}
            books={books}
            onOpen={() => selectNav('Learning Paths')}
            onUpdate={(updated) => {
              const next = paths.map((path) => (path.id === updated.id ? updated : path))
              setPaths(next)
              writePaths(next)
            }}
            onAsk={(prompt) => {
              openNoemaPanel(prompt)
              void askNoema(prompt)
            }}
          />
        </FreeCopyContext.Provider>
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
      <Page title="Learning paths" subtitle="Describe a goal and Noema will plan the path, or group books yourself.">
        <FreeCopyContext.Provider value={addResource}>
          <PathPlanner onSave={savePlannedPath} onNotice={showNotice} />
          <h3 className="paths-own-heading">Or build your own</h3>
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
                  ? { ...path, bookIds: [...path.bookIds, bookId], updated: new Date().toISOString() }
                  : path,
              )
              setPaths(next)
              writePaths(next)
            }}
            onAsk={(prompt) => {
              openNoemaPanel(prompt)
              void askNoema(prompt)
            }}
            onUpdate={(updated) => {
              const next = paths.map((path) => (path.id === updated.id ? updated : path))
              setPaths(next)
              writePaths(next)
            }}
          />
        </FreeCopyContext.Provider>
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
  async function syncEverything() {
    if (!authUser || isAnonymousUser(authUser)) {
      showNotice('Sign in first to sync your library.')
      openSettings('account')
      return
    }
    setCloudSyncing(true)
    try {
      let current = books
      try {
        current = await syncAccountLibrary(readLibraryBooks())
        setBooks(current)
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : ''
        showNotice(
          /Bucket not found|NoSuchBucket/i.test(message)
            ? 'Run the Noesis storage migration in Supabase to sync uploaded books.'
            : message || 'Your book files could not be synced.',
        )
      }
      let bundle: SyncBundle = { events, cards: readReviewCards(), focus: focusToSync(focusState), paths }
      try {
        bundle = await syncAccountBundle(bundle)
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : ''
        showNotice(message || 'Your calendar and review cards could not be synced.')
      }
      const accountPaths = bundle.paths ?? paths
      let state: CloudSyncState = {
        books: current,
        notes,
        paths: accountPaths as unknown[],
        bundle: { ...bundle, paths: undefined },
      }
      for (const connection of cloudConnections.filter(
        (item) => item.ownerUserId === authUserId && item.expiresAt > Date.now() + 30_000,
      )) {
        state = await syncCloudState(connection, state)
      }
      setBooks(state.books)
      setNotes(state.notes)
      setPaths(state.paths as LearningPath[])
      writeLibraryBooks(state.books)
      writeLocalNotes(state.notes)
      writePaths(state.paths as LearningPath[])
      if (state.bundle) applyBundle(state.bundle)
      markSynced()
      showNotice('Everything is up to date.')
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Sync failed. Try again in a moment.')
    } finally {
      setCloudSyncing(false)
    }
  }
  function backupSection() {
    const signedIn = Boolean(authUser && !isAnonymousUser(authUser))
    const protectedNow = signedIn && Boolean(lastSyncedAt) && online
    const headline = !online
      ? 'You are offline'
      : !signedIn
        ? 'Sign in to protect your library'
        : cloudSyncing
          ? 'Syncing your latest changes…'
          : protectedNow
            ? 'Everything is protected'
            : 'Ready to sync'
    const detail = !online
      ? 'Changes stay on this device until you reconnect.'
      : !signedIn
        ? 'Create an account or sign in so your books and notes can follow you to other devices.'
        : lastSyncedAt
          ? `Last sync: ${timeAgo(lastSyncedAt)}${settings.backup.autoSync ? '' : ' · automatic sync is off'}`
          : settings.backup.autoSync
            ? 'Your first sync will run shortly.'
            : 'Automatic sync is off. Use Sync now.'
    return (
      <>
        <section className={`sync-status panel-card${protectedNow ? '' : ' sync-status-warn'}`}>
          <div>
            {protectedNow ? (
              <CheckCircle2 size={34} className="sync-status-icon" />
            ) : (
              <Cloud size={34} className="sync-status-icon" />
            )}
            <div>
              <h3>{headline}</h3>
              <p>{detail}</p>
            </div>
          </div>
          <button className="primary-button" onClick={() => void syncEverything()} disabled={cloudSyncing || !online}>
            <RotateCcw size={14} /> {cloudSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        </section>
        <Group title="Cloud backup" icon={<Cloud size={18} />}>
          <p className="setting-note">
            Signed-in accounts sync to private Noesis storage automatically. You can also connect your own cloud
            storage. Each provider only sees a Noesis app folder, and a connection is per device.
          </p>
        </Group>
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
        <Group title="Offline backup" icon={<Download size={18} />}>
          <Row title="Export a ZIP" detail="A copy of your books, notes, and learning paths for one-off transfers.">
            <button className="secondary-button" onClick={() => void downloadBackupFile(books, notes, paths)}>
              <Download size={15} /> Export
            </button>
          </Row>
          <Row title="Restore from a ZIP" detail="Brings back a Noesis export on this device.">
            <button className="secondary-button" onClick={() => backupInput.current?.click()}>
              <Upload size={15} /> Restore
            </button>
          </Row>
        </Group>
        <Group title="Backup options" icon={<RotateCcw size={18} />}>
          <Row title="Automatic sync" detail="Sync in the background when your library or notes change.">
            <Toggle
              checked={settings.backup.autoSync}
              onChange={(value) => updateSettings({ ...settings, backup: { ...settings.backup, autoSync: value } })}
              label="Automatic sync"
            />
          </Row>
          <p className="setting-note">
            Synced: books and files, highlights and notes, reading progress, learning paths, your calendar, today’s
            focus steps, and review cards. These settings and the focus timer stay on this device.
          </p>
        </Group>
      </>
    )
  }
  function accountSection() {
    const anonymous = isAnonymousUser(authUser)
    return (
      <>
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
      </>
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
        reading={settings.reading}
        onReadingChange={(patch) => updateSettings({ ...settings, reading: { ...settings.reading, ...patch } })}
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
        <ReviewPage
          key={reviewRemount}
          notes={notes}
          onNotice={showNotice}
          onChanged={() => setDataVersion((value) => value + 1)}
        />
      </Page>
    ) : activeNav === 'Progress' ? (
      progressPage()
    ) : activeNav === 'Explore' ? (
      explorePage()
    ) : activeNav === 'Settings' ? (
      <SettingsPage
        section={settingsSection}
        onSection={setSettingsSection}
        settings={settings}
        onChange={updateSettings}
        account={accountSection()}
        backup={backupSection()}
        books={books}
        dueCount={dueCount}
        signedInEmail={authUser && !isAnonymousUser(authUser) ? (authUser.email ?? undefined) : undefined}
        onExport={() => void downloadBackupFile(books, notes, paths)}
        onClearLocal={clearLocalData}
        onNotice={showNotice}
      />
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
          <div className="brand-row brand-lockup">
            <NoesisMark size={84} />
            <strong>NOESIS</strong>
            <span>by Proairetos</span>
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
                className={`nav-item ${activeNav === label || (label === 'My Library' && activeNav === 'Read') ? 'nav-item-active' : ''}`}
                onClick={() => selectNav(label)}
                title={text}
              >
                <Icon size={17} />
                <span>{text}</span>
                {label === 'Review' && dueCount > 0 ? <b className="nav-badge">{dueCount}</b> : null}
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
          <button className="account-top-button" onClick={() => openSettings('account')} aria-label="Open account">
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
        {utilityOverlay === 'calendar' ? (
          <CalendarPanel
            now={now}
            events={events}
            onChange={updateEvents}
            initialDate={calendarSeed.date}
            startAdding={calendarSeed.adding}
            onClose={closeUtility}
          />
        ) : null}
        {utilityOverlay === 'weather' ? (
          <WeatherPanel settings={weatherSettings} onChange={updateWeather} onClose={closeUtility} />
        ) : null}
        <footer className="legal-footer">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </footer>
        {notice ? (
          <div className="toast-notice">
            <Sparkles size={15} /> {notice}
          </div>
        ) : null}
      </main>
      {activeNav !== 'Settings' ? (
        <ContextSidebar
          now={now}
          focus={focusState}
          remaining={focusRemaining}
          onFocusChange={updateFocusState}
          onToggleTimer={focusState.running ? pauseFocusTimer : startFocusTimer}
          onOpenFocus={() => selectNav('Focus')}
          events={events}
          onToggleEvent={(eventId, date) =>
            updateEvents(events.map((item) => (item.id === eventId ? toggleDone(item, date) : item)))
          }
          onOpenCalendar={(date, adding) => {
            setCalendarSeed({ date, adding })
            setUtilityOverlay('calendar')
          }}
          weather={weatherSettings}
          onWeatherChange={updateWeather}
          onOpenWeather={() => setUtilityOverlay('weather')}
          onAddNote={() => openNotePanel()}
          onAskNoema={() => openNoemaPanel()}
        />
      ) : null}
    </div>
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
const SHELF_KEY = 'noesis:home-shelf:v1'
type ShelfMode = 'reading' | 'added'

function ReadingShelfSection({
  books,
  onOpen,
  onImport,
}: {
  books: LibraryBook[]
  onOpen: (book: LibraryBook) => void
  onImport: () => void
}) {
  const [mode, setMode] = useState<ShelfMode>(() => {
    try {
      return localStorage.getItem(SHELF_KEY) === 'added' ? 'added' : 'reading'
    } catch {
      return 'reading'
    }
  })
  const change = (next: ShelfMode) => {
    setMode(next)
    try {
      localStorage.setItem(SHELF_KEY, next)
    } catch {
      // The choice just won't be remembered.
    }
  }
  const shelf =
    mode === 'reading'
      ? books.filter((book) => book.progress > 0).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
      : [...books].sort((a, b) => (b.added ?? b.updated ?? '').localeCompare(a.added ?? a.updated ?? ''))
  return (
    <section className="section-block shelf-section">
      <div className="section-heading">
        <div>
          <h2>
            <select
              className="shelf-select"
              value={mode}
              onChange={(event) => change(event.target.value as ShelfMode)}
              aria-label="Choose which books to show"
            >
              <option value="reading">Recently reading</option>
              <option value="added">Recently added</option>
            </select>
          </h2>
          <p>
            {mode === 'reading'
              ? 'A quiet shelf for the books you are spending time with.'
              : 'The newest books in your library.'}
          </p>
        </div>
        <button className="text-button" onClick={onImport}>
          Add book <Plus size={14} />
        </button>
      </div>
      {books.length === 0 ? (
        <button className="empty-state" onClick={onImport}>
          Your shelf is waiting for its first book.
        </button>
      ) : shelf.length === 0 ? (
        <div className="empty-state">You haven’t started a book yet. Open one and it will appear here.</div>
      ) : (
        <div className="bookshelf-row">
          {shelf.slice(0, 8).map((book) => (
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
          <button className="shelf-book shelf-add" onClick={onImport}>
            <div className="shelf-cover shelf-add-cover">
              <Plus size={22} />
            </div>
            <strong>Add a book</strong>
          </button>
        </div>
      )}
    </section>
  )
}
const TILE_IMAGES = ['/noesis-hero.jpg', '/noesis-header.webp', '/noesis-sidebar.webp']
const hashOf = (value: string) => [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
function pathIcon(title: string) {
  const text = title.toLowerCase()
  if (/psych|mind|brain|cogni|neuro/.test(text)) return Brain
  if (/comput|network|program|code|python|cyber|software|data|\bit\b|tech/.test(text)) return Cpu
  if (/focus|product|habit|growth|goal|career/.test(text)) return Target
  if (/financ|money|invest|econom|business/.test(text)) return Landmark
  if (/science|biolog|chem|physic|math|medic|mcat/.test(text)) return FlaskConical
  if (/write|novel|story|read|book|liter/.test(text)) return BookOpen
  return Compass
}

function PathSection({
  paths,
  books,
  onOpen,
  editable = false,
  onDelete,
  onAssign,
  onUpdate,
  onAsk,
}: {
  paths: LearningPath[]
  books: LibraryBook[]
  onOpen?: () => void
  editable?: boolean
  onDelete?: (id: string) => void
  onAssign?: (pathId: string, bookId: string) => void
  onUpdate?: (path: LearningPath) => void
  onAsk?: (prompt: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const progressOf = (path: LearningPath) => {
    const pathBooks = books.filter((book) => path.bookIds.includes(book.id))
    const plan = path.plan ? planProgress(path.plan) : null
    const percent = plan
      ? plan.percent
      : pathBooks.length
        ? Math.round(pathBooks.reduce((sum, book) => sum + book.progress, 0) / pathBooks.length)
        : 0
    return { pathBooks, plan, percent }
  }
  const active = paths.find((path) => path.id === selected) ?? null
  const detail = active ? progressOf(active) : null
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
        <div className="path-tiles">
          {paths.map((path) => {
            const { pathBooks, plan, percent } = progressOf(path)
            const Icon = pathIcon(path.title)
            const seed = hashOf(path.id)
            return (
              <button
                key={path.id}
                className={`path-tile${selected === path.id ? ' path-tile-active' : ''}`}
                onClick={() => setSelected(selected === path.id ? null : path.id)}
                aria-expanded={selected === path.id}
              >
                <span
                  className="path-tile-art"
                  style={{
                    backgroundImage: `url(${TILE_IMAGES[seed % TILE_IMAGES.length]})`,
                    backgroundPosition: `${seed % 100}% ${(seed >> 3) % 100}%`,
                  }}
                  aria-hidden="true"
                />
                <span className="path-tile-body">
                  <span className="path-tile-icon">
                    <Icon size={16} />
                  </span>
                  <strong>{path.title}</strong>
                  <small>
                    {plan
                      ? `${plan.done} / ${plan.total} topics`
                      : `${pathBooks.length} ${pathBooks.length === 1 ? 'book' : 'books'}`}
                  </small>
                  <span className="path-tile-track">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </span>
                <ArrowRight size={14} className="path-tile-arrow" />
              </button>
            )
          })}
          {onOpen ? (
            <button className="path-tile path-tile-new" onClick={onOpen}>
              <Plus size={20} />
              <strong>Plan a new path</strong>
            </button>
          ) : null}
        </div>
      )}
      {active && detail ? (
        <article className="path-detail panel-card">
          <div className="path-detail-head">
            <div>
              <h3>{active.title}</h3>
              <p>{active.description}</p>
              <small>
                {detail.plan
                  ? `${detail.plan.done} of ${detail.plan.total} topics · ${active.plan?.weeks ?? ''}`
                  : `${detail.pathBooks.length} ${detail.pathBooks.length === 1 ? 'book' : 'books'}`}{' '}
                · {detail.percent >= 100 ? 'Complete' : `${detail.percent}%`}
              </small>
            </div>
            {editable ? (
              <button
                className="path-delete"
                onClick={() => {
                  setSelected(null)
                  onDelete?.(active.id)
                }}
                aria-label={`Delete ${active.title}`}
              >
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
          {active.plan && onUpdate ? <PathPlanDetail path={active} onChange={onUpdate} onAsk={onAsk} /> : null}
          {detail.pathBooks.length ? (
            <ul className="path-detail-books">
              {detail.pathBooks.map((book) => (
                <li key={book.id}>
                  {book.title} <small>{Math.round(book.progress)}%</small>
                </li>
              ))}
            </ul>
          ) : null}
          {editable && books.length > 0 ? (
            <select
              className="path-book-select"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onAssign?.(active.id, event.target.value)
                event.target.value = ''
              }}
            >
              <option value="">Add a book…</option>
              {books
                .filter((book) => !active.bookIds.includes(book.id))
                .map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
            </select>
          ) : null}
        </article>
      ) : null}
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
