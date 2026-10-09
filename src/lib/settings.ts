// User preferences, stored locally. Every value here is read by the app, so a
// setting that appears in the Settings page changes behaviour.

export type ReaderTheme = 'paper' | 'sepia' | 'night' | 'contrast'
export type ReaderFont = 'book' | 'serif' | 'sans' | 'easy' | 'custom'
export type SurfaceName =
  'midnight' | 'charcoal' | 'forest' | 'plum' | 'espresso' | 'ocean' | 'wine' | 'indigo' | 'slate' | 'olive'
export type LetterSpacing = 'normal' | 'wide'
export type AccentName = 'gold' | 'blue' | 'green' | 'rose' | 'violet' | 'orange' | 'teal' | 'red'
export type LibrarySortSetting = 'recent' | 'title' | 'progress'
export type ParagraphStyle = 'book' | 'indent' | 'space'
export type LineWidth = 'full' | 'comfortable' | 'narrow'
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
    justify: boolean
    paragraphs: ParagraphStyle
    lineWidth: LineWidth
    dropCap: boolean
    letterSpacing: LetterSpacing
    tapZones: boolean
    chapterEnd: boolean
    dim: number // 0 to 60: how much the page is darkened
    autoScrollSpeed: number // 1 to 10
  }
  appearance: { accent: AccentName; surface: SurfaceName; scenery: boolean; reduceMotion: boolean; compact: boolean }
  library: {
    defaultSort: LibrarySortSetting
    indexText: boolean
    confirmDelete: boolean
    resurface: boolean
    goal: { enabled: boolean; target: number; period: GoalPeriod }
  }
  backup: { autoSync: boolean }
  ai: {
    enabled: boolean
    length: AnswerLength
    useReadingText: boolean
    useNotes: boolean
    avoidSpoilers: boolean
    onDevice: boolean
  }
  notifications: { reviewReminders: boolean }
  ui: { mode: 'auto' | 'reader' | 'learner' } // auto: learning turns on once a path exists
}

export const DEFAULT_SETTINGS: Settings = {
  reading: {
    fontSize: 100,
    theme: 'paper',
    font: 'book',
    lineHeight: 1.65,
    startWide: false,
    speechRate: 1,
    justify: false,
    paragraphs: 'book',
    lineWidth: 'full',
    dropCap: false,
    letterSpacing: 'normal',
    tapZones: false,
    chapterEnd: true,
    dim: 0,
    autoScrollSpeed: 3,
  },
  appearance: { accent: 'gold', surface: 'midnight', scenery: true, reduceMotion: false, compact: false },
  library: {
    defaultSort: 'recent',
    indexText: true,
    confirmDelete: true,
    resurface: true,
    goal: { enabled: false, target: 12, period: 'year' },
  },
  backup: { autoSync: true },
  ai: { enabled: true, length: 'balanced', useReadingText: true, useNotes: true, avoidSpoilers: true, onDevice: false },
  notifications: { reviewReminders: false },
  ui: { mode: 'auto' },
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
  violet: {
    label: 'Violet',
    main: '#a98bf0',
    soft: '#dccffc',
    light: '#bba2f5',
    fill: '#7d5fcf',
    border: '#b399f2',
    hover: '#9374e0',
    rgb: '190, 165, 245',
  },
  orange: {
    label: 'Orange',
    main: '#ec9a4e',
    soft: '#f9d6b0',
    light: '#f2ae6d',
    fill: '#c97a2e',
    border: '#f0a45e',
    hover: '#dc8a3d',
    rgb: '240, 175, 110',
  },
  teal: {
    label: 'Teal',
    main: '#4fc9bd',
    soft: '#bdeee9',
    light: '#6fd6cc',
    fill: '#2f9f95',
    border: '#5fd0c5',
    hover: '#41b8ac',
    rgb: '130, 220, 210',
  },
  red: {
    label: 'Red',
    main: '#e8675f',
    soft: '#f7c4c0',
    light: '#ee8079',
    fill: '#c04540',
    border: '#ec7770',
    hover: '#d6544e',
    rgb: '240, 150, 145',
  },
}

export const FONT_STACKS: Record<ReaderFont, string | null> = {
  book: null, // keep the book's own typography
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  // Fonts with open, clearly different letter shapes. Uses OpenDyslexic or Atkinson if installed.
  custom: 'NoesisCustom, Georgia, serif',
  easy: "OpenDyslexic, 'Atkinson Hyperlegible', Lexend, Verdana, Tahoma, sans-serif",
}

export const READER_COLORS: Record<ReaderTheme, { background: string; color: string }> = {
  night: { background: '#111a22', color: '#dce8f2' },
  contrast: { background: '#000000', color: '#ffff66' },
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
      theme: pick(reading.theme, ['paper', 'sepia', 'night', 'contrast'], d.reading.theme),
      font: pick(reading.font, ['book', 'serif', 'sans', 'easy', 'custom'], d.reading.font),
      lineHeight: Math.round(num(reading.lineHeight, 1.3, 2.2, d.reading.lineHeight) * 20) / 20,
      startWide: bool(reading.startWide, d.reading.startWide),
      speechRate: Math.round(num(reading.speechRate, 0.6, 1.6, d.reading.speechRate) * 10) / 10,
      justify: bool(reading.justify, d.reading.justify),
      paragraphs: pick(reading.paragraphs, ['book', 'indent', 'space'], d.reading.paragraphs),
      lineWidth: pick(reading.lineWidth, ['full', 'comfortable', 'narrow'], d.reading.lineWidth),
      dropCap: bool(reading.dropCap, d.reading.dropCap),
      tapZones: bool(reading.tapZones, d.reading.tapZones),
      chapterEnd: bool(reading.chapterEnd, d.reading.chapterEnd),
      dim: Math.round(num(reading.dim, 0, 60, d.reading.dim) / 5) * 5,
      autoScrollSpeed: Math.round(num(reading.autoScrollSpeed, 1, 10, d.reading.autoScrollSpeed)),
      letterSpacing: pick(reading.letterSpacing, ['normal', 'wide'], d.reading.letterSpacing),
    },
    appearance: {
      accent: pick(
        appearance.accent,
        ['gold', 'blue', 'green', 'rose', 'violet', 'orange', 'teal', 'red'],
        d.appearance.accent,
      ),
      surface: pick(
        appearance.surface,
        ['midnight', 'charcoal', 'forest', 'plum', 'espresso', 'ocean', 'wine', 'indigo', 'slate', 'olive'],
        d.appearance.surface,
      ),
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
      onDevice: bool(ai.onDevice, d.ai.onDevice),
    },
    notifications: { reviewReminders: bool(notifications.reviewReminders, d.notifications.reviewReminders) },
    ui: { mode: pick(obj(root.ui).mode, ['auto', 'reader', 'learner'], d.ui.mode) },
  }
}

export function readSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return sanitizeSettings(null)
  }
}

const STAMP_KEY = 'noesis:settings-updated'

/** When these settings were last changed on this device (or last received from the account). Empty if never. */
export function settingsStamp(): string {
  try {
    return localStorage.getItem(STAMP_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeSettings(settings: Settings, stamp?: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
    localStorage.setItem(STAMP_KEY, stamp ?? new Date().toISOString())
  } catch {
    // Private browsing can block storage; settings then last for this session only.
  }
}

// The dark colours behind the whole app. Midnight is the stylesheet's own default.
// A dark set of colours built around one hue, so every theme keeps the same depth.
function surfaceFrom(hue: number, saturation = 1): Record<string, string> {
  const hex = (h: number, s: number, l: number) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
    const channel = (n: number) => {
      const k = (n + h / 30) % 12
      const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
      return Math.round(255 * value)
        .toString(16)
        .padStart(2, '0')
    }
    return `#${channel(0)}${channel(8)}${channel(4)}`
  }
  const sat = (value: number) => Math.round(value * saturation)
  return {
    '--surface-shell': hex(hue, sat(50), 7),
    '--surface-main-a': hex(hue, sat(45), 8),
    '--surface-main-b': hex(hue, sat(42), 11),
    '--surface-ctx-a': hex(hue, sat(50), 6),
    '--surface-ctx-b': hex(hue, sat(42), 9),
    '--surface-card-a': hex(hue, sat(36), 15),
    '--surface-card-b': hex(hue, sat(45), 8),
    '--surface-pop': hex(hue, sat(40), 10),
    '--surface-deep': hex(hue, sat(55), 5),
    '--surface-panel': `${hex(hue, sat(38), 11)}e6`,
  }
}

// The circle shown in Settings is a bright stand-in for each dark theme, so it can be seen on a dark page.
export const SURFACE_SWATCH: Record<SurfaceName, string> = {
  midnight: '#4aa3ff',
  charcoal: '#a3acb7',
  forest: '#3ecf7a',
  plum: '#c26bff',
  espresso: '#d9915a',
  ocean: '#25c7d9',
  wine: '#ff5c7c',
  indigo: '#7a7dff',
  slate: '#8fb0cc',
  olive: '#b3cf45',
}

export const SURFACES: Record<SurfaceName, { label: string; vars: Record<string, string> }> = {
  midnight: { label: 'Midnight', vars: {} },
  charcoal: {
    label: 'Charcoal',
    vars: {
      '--surface-panel': 'rgba(24, 27, 30, 0.9)',
      '--surface-shell': '#101214',
      '--surface-main-a': '#121416',
      '--surface-main-b': '#181b1e',
      '--surface-ctx-a': '#0d0f10',
      '--surface-ctx-b': '#131618',
      '--surface-card-a': '#1c2024',
      '--surface-card-b': '#111315',
      '--surface-pop': '#16191c',
      '--surface-deep': '#0b0c0e',
    },
  },
  forest: {
    label: 'Forest',
    vars: {
      '--surface-panel': 'rgba(13, 30, 21, 0.9)',
      '--surface-shell': '#08180f',
      '--surface-main-a': '#0a1b12',
      '--surface-main-b': '#0e2418',
      '--surface-ctx-a': '#07140d',
      '--surface-ctx-b': '#0b1d13',
      '--surface-card-a': '#12291c',
      '--surface-card-b': '#09170f',
      '--surface-pop': '#0e2016',
      '--surface-deep': '#06110a',
    },
  },
  plum: {
    label: 'Plum',
    vars: {
      '--surface-panel': 'rgba(30, 18, 41, 0.9)',
      '--surface-shell': '#160d1f',
      '--surface-main-a': '#190f24',
      '--surface-main-b': '#21142e',
      '--surface-ctx-a': '#120a1a',
      '--surface-ctx-b': '#1a1025',
      '--surface-card-a': '#291a38',
      '--surface-card-b': '#150c1e',
      '--surface-pop': '#1d1229',
      '--surface-deep': '#0e0714',
    },
  },
  espresso: {
    label: 'Espresso',
    vars: {
      '--surface-panel': 'rgba(34, 24, 17, 0.9)',
      '--surface-shell': '#1a120d',
      '--surface-main-a': '#1c130e',
      '--surface-main-b': '#261a13',
      '--surface-ctx-a': '#150e0a',
      '--surface-ctx-b': '#1e1510',
      '--surface-card-a': '#2d2018',
      '--surface-card-b': '#18100b',
      '--surface-pop': '#221711',
      '--surface-deep': '#100a07',
    },
  },
  ocean: { label: 'Ocean', vars: surfaceFrom(190) },
  wine: { label: 'Wine', vars: surfaceFrom(345) },
  indigo: { label: 'Indigo', vars: surfaceFrom(245) },
  slate: { label: 'Slate', vars: surfaceFrom(212, 0.5) },
  olive: { label: 'Olive', vars: surfaceFrom(75, 0.8) },
}
export const SURFACE_VARS = [...new Set(Object.values(SURFACES).flatMap((item) => Object.keys(item.vars)))]

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
    vars: {
      ...SURFACES[settings.appearance.surface].vars,
      ...(custom
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
        : {}),
    },
  }
}
