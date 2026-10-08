// Today's focus: a short checklist plus a reading timer.

export type FocusTask = { label: string; done: boolean }
export type FocusState = {
  title: string
  session: string
  tasks: FocusTask[]
  durationMinutes: number
  elapsedSeconds: number
  startedAt?: number
  running: boolean
}

const KEY = 'noesis:focus:v1'
export const MAX_FOCUS_TASKS = 12

export const defaultFocusState = (): FocusState => ({
  title: 'Today’s focus',
  session: 'Reading',
  tasks: [
    { label: 'Read for 30 minutes', done: false },
    { label: 'Capture 2 key ideas', done: false },
    { label: 'Reflect on one chapter', done: false },
    { label: 'Make one connection', done: false },
  ],
  durationMinutes: 25,
  elapsedSeconds: 0,
  running: false,
})

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
    tasks: saved.tasks
      .filter((task): task is FocusTask => Boolean(task && typeof task === 'object' && typeof task.label === 'string'))
      .map((task) => ({ label: task.label, done: Boolean(task.done) }))
      .slice(0, MAX_FOCUS_TASKS),
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
  return { ...state, tasks: [...state.tasks, { label: clean, done: false }] }
}

export function removeFocusTask(state: FocusState, index: number): FocusState {
  if (index < 0 || index >= state.tasks.length) return state
  return { ...state, tasks: state.tasks.filter((_, position) => position !== index) }
}

export function toggleFocusTask(state: FocusState, index: number): FocusState {
  return {
    ...state,
    tasks: state.tasks.map((task, position) => (position === index ? { ...task, done: !task.done } : task)),
  }
}

export function renameFocusTask(state: FocusState, index: number, label: string): FocusState {
  return { ...state, tasks: state.tasks.map((task, position) => (position === index ? { ...task, label } : task)) }
}
