// User preferences, stored locally. Every value here is read by the app, so a
// setting that appears in the Settings page changes behaviour.

export type ReaderTheme = 'paper' | 'sepia' | 'night'
export type ReaderFont = 'book' | 'serif' | 'sans'
export type AccentName = 'gold' | 'blue' | 'green' | 'rose'
export type LibrarySortSetting = 'recent' | 'title' | 'progress'
export type AnswerLength = 'concise' | 'balanced' | 'detailed'
export type GoalPeriod = 'month' | 'year'

export type Settings = {
  reading: {
    fontSize: number
    theme: ReaderTheme
    font: ReaderFont
    lineHeight: number
    startWide: boolean
    speechRate: number
  }
  appearance: { accent: AccentName; scenery: boolean; reduceMotion: boolean; compact: boolean }
  library: {
    defaultSort: LibrarySortSetting
    indexText: boolean
    confirmDelete: boolean
    resurface: boolean
    goal: { enabled: boolean; target: number; period: GoalPeriod }
  }
  backup: { autoSync: boolean }
  ai: { enabled: boolean; length: AnswerLength; useReadingText: boolean; useNotes: boolean; avoidSpoilers: boolean }
  notifications: { reviewReminders: boolean }
}

export const DEFAULT_SETTINGS: Settings = {
  reading: { fontSize: 100, theme: 'paper', font: 'book', lineHeight: 1.65, startWide: false, speechRate: 1 },
  appearance: { accent: 'gold', scenery: true, reduceMotion: false, compact: false },
  library: {
    defaultSort: 'recent',
    indexText: true,
    confirmDelete: true,
    resurface: true,
    goal: { enabled: false, target: 12, period: 'year' },
  },
  backup: { autoSync: true },
  ai: { enabled: true, length: 'balanced', useReadingText: true, useNotes: true, avoidSpoilers: true },
  notifications: { reviewReminders: false },
}

export const ACCENTS: Record<
  AccentName,
  { label: string; main: string; soft: string; light: string; fill: string; border: string; hover: string; rgb: string }
> = {
  gold: {
    label: 'Gold',
    main: '#c7a36a',
    soft: '#ead4a2',
    light: '#e2bc69',
    fill: '#b48b4e',
    border: '#d4ad68',
    hover: '#d0aa67',
    rgb: '220, 194, 142',
  },
  blue: {
    label: 'Blue',
    main: '#5b9cf0',
    soft: '#bcd8fb',
    light: '#78b0f6',
    fill: '#3f78c8',
    border: '#6aa3ee',
    hover: '#5189d8',
    rgb: '140, 190, 240',
  },
  green: {
    label: 'Green',
    main: '#6dbf8f',
    soft: '#c4e8d3',
    light: '#82cda0',
    fill: '#4f9a6f',
    border: '#7cc99c',
    hover: '#5fae80',
    rgb: '150, 215, 180',
  },
  rose: {
    label: 'Rose',
    main: '#d9808f',
    soft: '#f3c9d0',
    light: '#e393a1',
    fill: '#b8606f',
    border: '#e08c9a',
    hover: '#c87080',
    rgb: '235, 170, 182',
  },
}

export const FONT_STACKS: Record<ReaderFont, string | null> = {
  book: null, // keep the book's own typography
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
}

export const READER_COLORS: Record<ReaderTheme, { background: string; color: string }> = {
  night: { background: '#111a22', color: '#dce8f2' },
  sepia: { background: '#f1e6d0', color: '#4b3b2c' },
  paper: { background: '#f6f2e9', color: '#233a4e' },
}

export const ANSWER_TOKENS: Record<AnswerLength, number> = { concise: 450, balanced: 800, detailed: 1500 }

const KEY = 'noesis:settings:v1'

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// Accepts anything (corrupt storage, an older version) and returns a full,
// valid Settings object. Unknown or out-of-range values fall back to defaults.
export function sanitizeSettings(input: unknown): Settings {
  const root = obj(input)
  const reading = obj(root.reading)
  const appearance = obj(root.appearance)
  const library = obj(root.library)
  const goal = obj(library.goal)

  const backup = obj(root.backup)
  const ai = obj(root.ai)
  const notifications = obj(root.notifications)
  const d = DEFAULT_SETTINGS
  return {
    reading: {
      fontSize: Math.round(num(reading.fontSize, 85, 140, d.reading.fontSize) / 5) * 5,
      theme: pick(reading.theme, ['paper', 'sepia', 'night'], d.reading.theme),
      font: pick(reading.font, ['book', 'serif', 'sans'], d.reading.font),
      lineHeight: Math.round(num(reading.lineHeight, 1.3, 2.2, d.reading.lineHeight) * 20) / 20,
      startWide: bool(reading.startWide, d.reading.startWide),
      speechRate: Math.round(num(reading.speechRate, 0.6, 1.6, d.reading.speechRate) * 10) / 10,
    },
    appearance: {
      accent: pick(appearance.accent, ['gold', 'blue', 'green', 'rose'], d.appearance.accent),
      scenery: bool(appearance.scenery, d.appearance.scenery),
      reduceMotion: bool(appearance.reduceMotion, d.appearance.reduceMotion),
      compact: bool(appearance.compact, d.appearance.compact),
    },
    library: {
      defaultSort: pick(library.defaultSort, ['recent', 'title', 'progress'], d.library.defaultSort),
      indexText: bool(library.indexText, d.library.indexText),
      confirmDelete: bool(library.confirmDelete, d.library.confirmDelete),
      resurface: bool(library.resurface, d.library.resurface),
      goal: {
        enabled: bool(goal.enabled, d.library.goal.enabled),
        target: Math.round(num(goal.target, 1, 365, d.library.goal.target)),
        period: pick(goal.period, ['month', 'year'], d.library.goal.period),
      },
    },
    backup: { autoSync: bool(backup.autoSync, d.backup.autoSync) },
    ai: {
      enabled: bool(ai.enabled, d.ai.enabled),
      length: pick(ai.length, ['concise', 'balanced', 'detailed'], d.ai.length),
      useReadingText: bool(ai.useReadingText, d.ai.useReadingText),
      useNotes: bool(ai.useNotes, d.ai.useNotes),
      avoidSpoilers: bool(ai.avoidSpoilers, d.ai.avoidSpoilers),
    },
    notifications: { reviewReminders: bool(notifications.reviewReminders, d.notifications.reviewReminders) },
  }
}

export function readSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return sanitizeSettings(null)
  }
}

export function writeSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private browsing can block storage; settings then last for this session only.
  }
}

// Sets one value inside one section, returning a new object.
export function updateSetting<S extends keyof Settings, K extends keyof Settings[S]>(
  settings: Settings,
  section: S,
  key: K,
  value: Settings[S][K],
): Settings {
  return { ...settings, [section]: { ...settings[section], [key]: value } }
}

// What the document root needs so appearance settings take effect everywhere.
// Gold is the stylesheet's own default, so it sets no variables at all.
export function rootAppearance(settings: Settings): { classes: string[]; vars: Record<string, string> } {
  const accent = ACCENTS[settings.appearance.accent]
  const custom = settings.appearance.accent !== 'gold'
  return {
    classes: [
      settings.appearance.scenery ? '' : 'no-scenery',
      settings.appearance.reduceMotion ? 'reduce-motion' : '',
      settings.appearance.compact ? 'compact' : '',
    ].filter(Boolean),
    vars: custom
      ? {
          '--gold-warm': accent.main,
          '--gold-soft': accent.soft,
          '--accent-light': accent.light,
          '--accent-fill': accent.fill,
          '--accent-border': accent.border,
          '--accent-hover': accent.hover,
          '--accent-rgb': accent.rgb,
          '--accent-mark': accent.main,
        }
      : {},
  }
}
