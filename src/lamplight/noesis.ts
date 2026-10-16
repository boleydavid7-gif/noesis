// Noesis in Lamplight: each background is a room and each color a lamp, made by the scheme in its deep (premium)
// cut, so every color Noesis shows is checked for contrast and the whole app moves together when either changes.
import { rgba, toOklch, triple } from './color'
import { LAMP_SEEDS, makeScheme, schemeVars, type LampSeed, type RoomSeed, type Scheme } from './scheme'

/** Each background's page color, the room's hue and depth taken from it. Midnight is Noesis's own night blue. */
const BACKGROUNDS: Record<string, string> = {
  midnight: '#08111c',
  hearth: '#14100b',
  dusk: '#160d15',
  clay: '#1b0c06',
  charcoal: '#111214',
  forest: '#0a1b12',
  plum: '#160d1f',
  espresso: '#1a120d',
  ocean: '#08161a',
  wine: '#1a0b0f',
  indigo: '#0b0c1c',
  slate: '#0f1216',
  olive: '#13140a',
}

/** Noesis's gold is its own: a little warmer and softer than Lamplight's Amber. */
const GOLD: LampSeed = { hue: 80, chroma: 0.1 }

export function noesisRoom(background: string, shell?: string): RoomSeed {
  const { h, C } = toOklch(shell ?? BACKGROUNDS[background] ?? BACKGROUNDS.midnight)
  const hue = Math.round(h)
  return {
    hue,
    chroma: { dark: Math.min(C, 0.04), light: Math.min(C, 0.02) },
    glows: [
      [80, 0.1],
      [hue, 0.06],
      [hue, 0.04],
    ],
  }
}

export function noesisLamp(accent: string): LampSeed {
  if (accent === 'gold') return GOLD
  const name = (accent.charAt(0).toUpperCase() + accent.slice(1)) as keyof typeof LAMP_SEEDS
  return LAMP_SEEDS[name] ?? GOLD
}

export function noesisScheme(accent: string, background: string, shell?: string): Scheme {
  return makeScheme(noesisRoom(background, shell), noesisLamp(accent), 'dark', 'deep')
}

/** Noesis's own color names (design.css, App.css), set from the scheme, plus Lamplight's --ll-* roles. */
export function noesisVars(s: Scheme): Record<string, string> {
  return {
    ...schemeVars(s),
    '--tone-0': s.wall,
    '--tone-1': s.page,
    '--tone-2': s.card,
    '--tone-3': s.inset,
    '--tone-4': s.raised,
    '--paper': s.ink,
    '--paper-2': s.ink2,
    '--paper-3': s.ink3,
    '--hair': s.hair,
    '--line-strong': rgba(s.ink, 0.14),
    '--accent-mark': s.lamp,
    '--accent-rgb': triple(s.lamp),
    '--lamp-soft': s.lampSoft,
    '--on-lamp': s.onLamp,
    '--gold-warm': s.lamp,
    '--gold-soft': s.lampSoft,
    '--accent-light': s.lampSoft,
    '--accent-fill': s.lampFill,
    '--accent-border': s.lamp,
    '--accent-hover': s.lampSoft,
    '--surface-shell': s.page,
    '--surface-deep': s.wall,
    '--surface-main-a': s.page,
    '--surface-main-b': s.card,
    '--surface-ctx-a': s.wall,
    '--surface-ctx-b': s.page,
    '--surface-card-a': s.inset,
    '--surface-card-b': s.page,
    '--surface-pop': s.card,
    '--surface-panel': rgba(s.card, 0.9),
  }
}
