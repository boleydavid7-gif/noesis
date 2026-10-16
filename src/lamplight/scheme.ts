// Lamplight, copied from Proairetos (src/lamplight/scheme.ts); change it there first and copy it here, so the two stay one system.
import { contrast, oklch, rgba, triple, type Hex } from './color'

/*
 * Lamplight's scheme: every color a page uses, made from two seeds, a room (the hue every surface takes) and a lamp
 * (the one light: the main action, where you are, links). Like Material's seed color, but the story is a room lit
 * by one lamp. Each role is made in OKLCH, then checked against every surface it sits on and moved in lightness
 * until it passes: text 7:1, everything else that is read 4.5:1, so any seed, a preset or one a person picks, is
 * readable by construction. Pure; no DOM.
 */

export type Mode = 'dark' | 'light'

/** A room: its hue, how much of it the surfaces take in each mode, and the hues of its wallpaper's light. */
export type RoomSeed = {
  hue: number
  /** A room whose daylight is another hue (an app whose light page is cream and dark page forest). */
  lightHue?: number
  chroma: { dark: number; light: number }
  glows: [[number, number], [number, number], [number, number]]
}

/** A lamp: a hue and how strong it is. */
export type LampSeed = { hue: number; chroma: number }

export type Scheme = {
  mode: Mode
  /** Surfaces, deepest to highest: the side rail, the page, cards, a card inside a card, menus and popovers. */
  wall: Hex
  page: Hex
  card: Hex
  inset: Hex
  raised: Hex
  /** Text: body, secondary, faint; one hairline. */
  ink: Hex
  ink2: Hex
  ink3: Hex
  hair: string
  /** The lamp as text and marks (links, where you are, focus); the pill it fills; words on the pill; soft tints. */
  lamp: Hex
  lampFill: Hex
  lampSoft: Hex
  onLamp: Hex
  glow: string
  /** Removing something (never a failure color): a warm red, read as text on every surface. */
  remove: Hex
  /** Translucent bars. */
  bar: string
  /** The drawn wallpaper's colors: a sky, the lamp's glow and three bands. */
  art: { sky: Hex; glow: Hex; b1: Hex; b2: Hex; b3: Hex }
}

/** The rooms (Settings › Appearance). Their values were first made by the palette script; kept the same here. */
export const ROOM_SEEDS = {
  Hearth: {
    hue: 70,
    chroma: { dark: 0.012, light: 0.018 },
    glows: [
      [75, 0.13],
      [40, 0.1],
      [250, 0.05],
    ],
  },
  Dusk: {
    hue: 330,
    chroma: { dark: 0.022, light: 0.016 },
    glows: [
      [20, 0.12],
      [75, 0.11],
      [300, 0.09],
    ],
  },
  Harbor: {
    hue: 252,
    chroma: { dark: 0.03, light: 0.014 },
    glows: [
      [75, 0.12],
      [230, 0.08],
      [270, 0.07],
    ],
  },
  Grove: {
    hue: 158,
    chroma: { dark: 0.022, light: 0.016 },
    glows: [
      [95, 0.11],
      [150, 0.08],
      [190, 0.06],
    ],
  },
  Clay: {
    hue: 42,
    chroma: { dark: 0.03, light: 0.022 },
    glows: [
      [55, 0.13],
      [25, 0.11],
      [80, 0.08],
    ],
  },
  Slate: {
    hue: 255,
    chroma: { dark: 0.008, light: 0.006 },
    glows: [
      [75, 0.08],
      [250, 0.03],
      [200, 0.03],
    ],
  },
} as const satisfies Record<string, RoomSeed>

export const LAMP_SEEDS = {
  Amber: { hue: 75, chroma: 0.12 },
  Ember: { hue: 45, chroma: 0.14 },
  Rose: { hue: 8, chroma: 0.11 },
  Heather: { hue: 320, chroma: 0.09 },
  Ink: { hue: 262, chroma: 0.1 },
  Tide: { hue: 205, chroma: 0.09 },
  Sage: { hue: 145, chroma: 0.085 },
  Pewter: { hue: 75, chroma: 0.018 },
} as const satisfies Record<string, LampSeed>

export type RoomName = keyof typeof ROOM_SEEDS
export type LampName = keyof typeof LAMP_SEEDS

/** The color each room was made with ("Match"). */
export const ROOM_LAMP: Record<RoomName, LampName> = {
  Hearth: 'Amber',
  Dusk: 'Rose',
  Harbor: 'Amber',
  Grove: 'Sage',
  Clay: 'Ember',
  Slate: 'Pewter',
}

/** A lamp of the person's own: any hue, at a chroma that keeps it a lamp rather than a neon. */
export const ownLamp = (hue: number): LampSeed => ({ hue: ((hue % 360) + 360) % 360, chroma: 0.11 })

// ---------- Making the roles ----------

/** Moves a color's lightness away from its backgrounds until it reaches the contrast it needs on all of them. */
function readable(L: number, C: number, h: number, on: string[], need: number, darker: boolean): Hex {
  let l = L
  let hex = oklch(l, C, h)
  for (let i = 0; i < 120 && on.some((bg) => contrast(hex, bg) < need); i += 1) {
    l = darker ? l - 0.005 : l + 0.005
    if (l <= 0 || l >= 1) break
    hex = oklch(l, C, h)
  }
  return hex
}

/** How a scheme is cut: `deep` is the premium room (Noesis): darker, with more distance between its layers, a finer
 *  hairline and a richer lamp. Contrast is held to the same numbers either way. */
export type Depth = 'standard' | 'deep'

/** The scheme for a room and a lamp, in dark or light. */
export function makeScheme(room: RoomSeed, lamp: LampSeed, mode: Mode, depth: Depth = 'standard'): Scheme {
  const dark = mode === 'dark'
  const h = dark ? room.hue : (room.lightHue ?? room.hue)
  const c = room.chroma[mode]
  // A room with almost no hue keeps its paper warm, as Slate always has.
  const textHue = room.chroma.dark > 0.01 ? h : dark ? 75 : 70
  const [[g1, c1], [g2, c2], [g3, c3]] = room.glows

  const deep = depth === 'deep'
  const tones =
    deep && dark
      ? {
          wall: oklch(0.12, c * 1.1, h),
          page: oklch(0.15, c * 1.15, h),
          card: oklch(0.195, c * 1.05, h),
          inset: oklch(0.235, c, h),
          raised: oklch(0.275, c, h),
        }
      : dark
        ? {
            wall: oklch(0.145, c, h),
            page: oklch(0.175, c, h),
            card: oklch(0.215, c, h),
            inset: oklch(0.25, c, h),
            raised: oklch(0.29, c * 1.1, h),
          }
        : {
            wall: oklch(0.935, c, h),
            page: oklch(0.965, c, h),
            card: oklch(0.993, c * 0.4, h),
            inset: oklch(0.945, c, h),
            raised: oklch(0.915, c * 1.1, h),
          }
  const surfaces = [tones.page, tones.card, tones.inset]

  const ink = readable(dark ? 0.95 : 0.24, 0.012 + (dark ? 0 : 0.008), textHue, surfaces, 7, !dark)
  const ink2 = readable(dark ? 0.8 : 0.45, dark ? 0.02 : 0.025, textHue, surfaces, 4.5, !dark)
  const ink3 = readable(dark ? 0.67 : 0.51, dark ? 0.022 : 0.025, textHue, surfaces, 4.5, !dark)

  // The lamp. Dark: one bright color for text, marks and the pill. Light: a deeper one that reads as text, and a
  // brighter fill for the pill.
  const on = oklch(0.2, Math.min(lamp.chroma, 0.05), lamp.hue)
  let lampText: Hex
  let fill: Hex
  let soft: Hex
  if (dark) {
    lampText = readable(deep ? 0.81 : 0.8, deep ? lamp.chroma * 1.08 : lamp.chroma, lamp.hue, surfaces, 4.5, false)
    fill = lampText
    soft = oklch(0.88, lamp.chroma * 0.6, lamp.hue)
  } else {
    // The deepest the palette script found that reads 5.2:1 on paper and on white, then checked on this room.
    let found = oklch(0.62, lamp.chroma, lamp.hue)
    for (let L = 0.62; L > 0.38; L -= 0.005) {
      found = oklch(L, lamp.chroma, lamp.hue)
      if (contrast(found, oklch(0.965, 0.012, 70)) >= 5.2 && contrast(found, '#ffffff') >= 5.2) break
    }
    lampText = surfaces.every((bg) => contrast(found, bg) >= 4.5)
      ? found
      : readable(0.55, lamp.chroma, lamp.hue, surfaces, 4.5, true)
    fill = oklch(0.78, lamp.chroma * 1.05, lamp.hue)
    soft = lampText
  }
  const onLamp =
    contrast(on, fill) >= 4.5 ? on : readable(0.2, Math.min(lamp.chroma, 0.05), lamp.hue, [fill], 4.5, true)

  const remove = readable(dark ? 0.78 : 0.5, dark ? 0.11 : 0.15, 25, surfaces, 4.5, !dark)

  return {
    mode,
    ...tones,
    ink,
    ink2,
    ink3,
    hair: rgba(ink, deep ? 0.06 : dark ? 0.075 : 0.09),
    lamp: lampText,
    lampFill: fill,
    lampSoft: soft,
    onLamp,
    glow: rgba(dark ? lampText : fill, dark ? 0.15 : 0.18),
    remove,
    bar: rgba(dark ? tones.page : tones.card, dark ? 0.72 : 0.8),
    art: dark
      ? {
          sky: oklch(0.31, c * 1.5 + 0.02, h),
          glow: oklch(0.83, c1, g1),
          b1: oklch(0.6, c2, g2),
          b2: oklch(0.45, c3, g3),
          b3: oklch(0.3, c * 1.8 + 0.015, h),
        }
      : {
          sky: oklch(0.975, c * 1.4 + 0.01, h),
          glow: oklch(0.88, c1 * 1.05, g1),
          b1: oklch(0.86, c2 * 0.9, g2),
          b2: oklch(0.8, c3 * 0.9, g3),
          b3: oklch(0.92, c * 2 + 0.01, h),
        },
  }
}

/** The roles as CSS custom properties, `--ll-*`, the names every Lamplight rule is written against. */
export function schemeVars(s: Scheme): Record<string, string> {
  return {
    '--ll-wall': s.wall,
    '--ll-page': s.page,
    '--ll-page-rgb': triple(s.page),
    '--ll-card': s.card,
    '--ll-inset': s.inset,
    '--ll-raised': s.raised,
    '--ll-ink': s.ink,
    '--ll-ink-rgb': triple(s.ink),
    '--ll-ink-2': s.ink2,
    '--ll-ink-3': s.ink3,
    '--ll-hair': s.hair,
    '--ll-lamp': s.lamp,
    '--ll-lamp-rgb': triple(s.mode === 'dark' ? s.lamp : s.lampFill),
    '--ll-lamp-fill': s.lampFill,
    '--ll-lamp-soft': s.lampSoft,
    '--ll-on-lamp': s.onLamp,
    '--ll-glow': s.glow,
    '--ll-remove': s.remove,
    '--ll-bar': s.bar,
  }
}
