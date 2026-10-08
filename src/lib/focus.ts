// Today's focus: a short checklist plus a reading timer.

export type FocusTask = { id: string; label: string; done: boolean; updated?: string }
export type FocusState = {
  title: string
  session: string
  tasks: FocusTask[]
  durationMinutes: number
  elapsedSeconds: number
  startedAt?: number
  running: boolean
  metaUpdated?: string // when the title, session name or length last changed
}

const KEY = 'noesis:focus:v1'
export const MAX_FOCUS_TASKS = 12

export const defaultFocusState = (): FocusState => ({
  title: 'Today’s focus',
  session: 'Reading',
  // Fixed ids so the starter steps match on every device instead of doubling up.
  tasks: [
    { id: 'starter-read', label: 'Read for 30 minutes', done: false },
    { id: 'starter-ideas', label: 'Capture 2 key ideas', done: false },
    { id: 'starter-reflect', label: 'Reflect on one chapter', done: false },
    { id: 'starter-connect', label: 'Make one connection', done: false },
  ],
  durationMinutes: 25,
  elapsedSeconds: 0,
  running: false,
})

const STARTER_IDS: Record<string, string> = {
  'Read for 30 minutes': 'starter-read',
  'Capture 2 key ideas': 'starter-ideas',
  'Reflect on one chapter': 'starter-reflect',
  'Make one connection': 'starter-connect',
}

// Steps saved before ids existed get one: the starter steps keep their shared
// ids, anything else gets a stable id from its position and text.
export function sanitizeTasks(value: unknown): FocusTask[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tasks: FocusTask[] = []
  value.forEach((item, index) => {
    const task = item as Partial<FocusTask> | null
    if (!task || typeof task !== 'object' || typeof task.label !== 'string') return
    let id =
      typeof task.id === 'string' && task.id
        ? task.id
        : (STARTER_IDS[task.label] ?? `legacy-${index}-${task.label.length}`)
    if (seen.has(id)) id = `${id}-${index}`
    seen.add(id)
    tasks.push({
      id,
      label: task.label,
      done: Boolean(task.done),
      updated: typeof task.updated === 'string' ? task.updated : undefined,
    })
  })
  return tasks.slice(0, MAX_FOCUS_TASKS)
}

export function sanitizeFocusState(value: unknown): FocusState {
  const base = defaultFocusState()
  const saved = (value ?? null) as Partial<FocusState> | null
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.tasks)) return base
  const duration =
    typeof saved.durationMinutes === 'number' && saved.durationMinutes >= 1
      ? Math.min(240, Math.round(saved.durationMinutes))
      : base.durationMinutes
  return {
    title: typeof saved.title === 'string' && saved.title.trim() ? saved.title : base.title,
    session: typeof saved.session === 'string' && saved.session.trim() ? saved.session : base.session,
    tasks: sanitizeTasks(saved.tasks),
    metaUpdated: typeof saved.metaUpdated === 'string' ? saved.metaUpdated : undefined,
    durationMinutes: duration,
    elapsedSeconds: typeof saved.elapsedSeconds === 'number' && saved.elapsedSeconds > 0 ? saved.elapsedSeconds : 0,
    startedAt: typeof saved.startedAt === 'number' ? saved.startedAt : undefined,
    running: Boolean(saved.running),
  }
}

export function readFocusState(): FocusState {
  try {
    return sanitizeFocusState(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return defaultFocusState()
  }
}

export function writeFocusState(value: FocusState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Local storage can be unavailable in private browsing.
  }
}

export function focusRemainingSeconds(value: FocusState, now = Date.now()): number {
  const elapsed =
    value.elapsedSeconds + (value.running && value.startedAt ? Math.floor((now - value.startedAt) / 1000) : 0)
  return Math.max(0, value.durationMinutes * 60 - elapsed)
}

export function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function addFocusTask(state: FocusState, label: string): FocusState {
  const clean = label.trim().slice(0, 120)
  if (!clean || state.tasks.length >= MAX_FOCUS_TASKS) return state
  const task = { id: `focus-${crypto.randomUUID()}`, label: clean, done: false, updated: new Date().toISOString() }
  return { ...state, tasks: [...state.tasks, task] }
}

export function removeFocusTask(state: FocusState, index: number): FocusState {
  if (index < 0 || index >= state.tasks.length) return state
  return { ...state, tasks: state.tasks.filter((_, position) => position !== index) }
}

export function toggleFocusTask(state: FocusState, index: number): FocusState {
  return {
    ...state,
    tasks: state.tasks.map((task, position) =>
      position === index ? { ...task, done: !task.done, updated: new Date().toISOString() } : task,
    ),
  }
}

export function renameFocusTask(state: FocusState, index: number, label: string): FocusState {
  return {
    ...state,
    tasks: state.tasks.map((task, position) =>
      position === index ? { ...task, label, updated: new Date().toISOString() } : task,
    ),
  }
}
