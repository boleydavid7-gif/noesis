import { noesisScheme, noesisVars } from '../lamplight/noesis'
// User preferences, stored locally. Every value here is read by the app, so a
// setting that appears in the Settings page changes behavior.

export type ReaderTheme = 'paper' | 'sepia' | 'night' | 'contrast'
export type ReaderFont = 'book' | 'serif' | 'sans' | 'easy' | 'custom'
export type SurfaceName =
  | 'midnight'
  | 'hearth'
  | 'dusk'
  | 'clay'
  | 'charcoal'
  | 'forest'
  | 'plum'
  | 'espresso'
  | 'ocean'
  | 'wine'
  | 'indigo'
  | 'slate'
  | 'olive'
export type LetterSpacing = 'normal' | 'wide'
export type AccentName = 'gold' | 'ember' | 'rose' | 'heather' | 'ink' | 'tide' | 'sage' | 'pewter'
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
    keepAwake: boolean // the screen stays on while a book is open
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
    keepAwake: true,
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
  ember: {
    label: 'Ember',
    main: '#ffa47a',
    soft: '#ffcab3',
    light: '#ffb28e',
    fill: '#c7805f',
    border: '#ffa982',
    hover: '#e6946e',
    rgb: '255, 164, 122',
  },
  rose: {
    label: 'Rose',
    main: '#fba0b0',
    soft: '#fec7cf',
    light: '#fcaebc',
    fill: '#c47d89',
    border: '#fba6b5',
    hover: '#e2909e',
    rgb: '251, 160, 176',
  },
  heather: {
    label: 'Heather',
    main: '#d8abe2',
    soft: '#e8cdee',
    light: '#deb8e6',
    fill: '#a885b0',
    border: '#dab0e4',
    hover: '#c29acb',
    rgb: '216, 171, 226',
  },
  ink: {
    label: 'Ink',
    main: '#9bbeff',
    soft: '#c3d8ff',
    light: '#aac8ff',
    fill: '#7994c7',
    border: '#a1c2ff',
    hover: '#8cabe6',
    rgb: '155, 190, 255',
  },
  tide: {
    label: 'Tide',
    main: '#71cfd9',
    soft: '#aee2e8',
    light: '#86d6df',
    fill: '#58a1a9',
    border: '#7ad2db',
    hover: '#66bac3',
    rgb: '113, 207, 217',
  },
  sage: {
    label: 'Sage',
    main: '#9ccd9c',
    soft: '#c3e1c3',
    light: '#abd4ab',
    fill: '#7aa07a',
    border: '#a2d0a2',
    hover: '#8cb88c',
    rgb: '156, 205, 156',
  },
  pewter: {
    label: 'Pewter',
    main: '#c5bcb1',
    soft: '#dcd7d0',
    light: '#cec6bd',
    fill: '#9a938a',
    border: '#c8c0b6',
    hover: '#b1a99f',
    rgb: '197, 188, 177',
  },
}

// Colors from before Lamplight's palette, carried to the nearest new one.
const OLD_ACCENTS: Record<string, AccentName> = {
  blue: 'ink',
  green: 'sage',
  violet: 'heather',
  orange: 'ember',
  teal: 'tide',
  red: 'ember',
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
      keepAwake: bool(reading.keepAwake, d.reading.keepAwake),
    },
    appearance: {
      accent: pick(
        OLD_ACCENTS[String(appearance.accent)] ?? appearance.accent,
        Object.keys(ACCENTS) as AccentName[],
        d.appearance.accent,
      ),
      surface: pick(appearance.surface, Object.keys(SURFACES) as SurfaceName[], d.appearance.surface),
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

// The dark colors behind the whole app. Midnight is the stylesheet's own default.
// A dark set of colors built around one hue, so every theme keeps the same depth.
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
  hearth: '#ebb25f',
  dusk: '#fba0b0',
  clay: '#ffa47a',
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
  hearth: {
    label: 'Hearth',
    vars: {
      '--surface-panel': '#1d1914e6',
      '--surface-shell': '#14100b',
      '--surface-main-a': '#14100b',
      '--surface-main-b': '#1d1914',
      '--surface-ctx-a': '#0d0905',
      '--surface-ctx-b': '#14100b',
      '--surface-card-a': '#25211b',
      '--surface-card-b': '#14100b',
      '--surface-pop': '#1d1914',
      '--surface-deep': '#0d0905',
    },
  },
  dusk: {
    label: 'Dusk',
    vars: {
      '--surface-panel': '#1f161ee6',
      '--surface-shell': '#160d15',
      '--surface-main-a': '#160d15',
      '--surface-main-b': '#1f161e',
      '--surface-ctx-a': '#0f070e',
      '--surface-ctx-b': '#160d15',
      '--surface-card-a': '#281e27',
      '--surface-card-b': '#160d15',
      '--surface-pop': '#1f161e',
      '--surface-deep': '#0f070e',
    },
  },
  clay: {
    label: 'Clay',
    vars: {
      '--surface-panel': '#25150ee6',
      '--surface-shell': '#1b0c06',
      '--surface-main-a': '#1b0c06',
      '--surface-main-b': '#25150e',
      '--surface-ctx-a': '#140602',
      '--surface-ctx-b': '#1b0c06',
      '--surface-card-a': '#2e1d16',
      '--surface-card-b': '#1b0c06',
      '--surface-pop': '#25150e',
      '--surface-deep': '#140602',
    },
  },
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

// The scheme (Lamplight, deep cut) for the chosen color and background.
export function appearanceScheme(settings: Settings) {
  const { accent, surface } = settings.appearance
  return noesisScheme(accent, surface, SURFACES[surface].vars['--surface-shell'])
}

// What the document root needs so appearance settings take effect everywhere: every color is made by Lamplight's
// scheme from the chosen color (the lamp) and background (the room), checked for contrast.
export function rootAppearance(settings: Settings): { classes: string[]; vars: Record<string, string> } {
  return {
    classes: [
      settings.appearance.scenery ? '' : 'no-scenery',
      settings.appearance.reduceMotion ? 'reduce-motion' : '',
      settings.appearance.compact ? 'compact' : '',
    ].filter(Boolean),
    vars: noesisVars(appearanceScheme(settings)),
  }
}

/** The colors Noesis's drawn wallpaper is made from: the page, the chosen color and the background's own hue. */
export function wallpaperColors(settings: Settings): { page: string; accent: string; hue: string } {
  const scheme = appearanceScheme(settings)
  return { page: scheme.page, accent: scheme.lamp, hue: SURFACE_SWATCH[settings.appearance.surface] }
}
