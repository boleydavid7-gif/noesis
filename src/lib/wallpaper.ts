/** Noesis's wallpaper, drawn the way Proairetos draws its Lamplight rooms (its app/wallpaper.ts) and taken a step
 *  further for a reading room: soft fields of the room's colors blooming into each other, a reading lamp toward the
 *  upper right as a warm glow (no rings, no hard center) with a faint veil of its light falling across, three silk
 *  folds sweeping below with light along their top edges, a satin sheen just under each edge and a soft shade
 *  beneath, a gentle vignette, a few dim stars above the folds and a fine grain so nothing bands. Drawn from the
 *  background and color chosen in Settings, so every choice has its own; a tall version for phones and a wide one
 *  for computers. */
export type WallArt = {
  sky: string
  glow: string
  b1: string
  b2: string
  b3: string
}

/** Fixed places for the stars (fractions of the picture), so every device draws the same sky. */
const STARS: [number, number, number][] = [
  [0.08, 0.05, 1.4],
  [0.19, 0.12, 1],
  [0.31, 0.04, 1.2],
  [0.43, 0.15, 0.8],
  [0.86, 0.05, 1.1],
  [0.95, 0.16, 1.3],
  [0.05, 0.21, 0.9],
  [0.25, 0.24, 0.8],
  [0.52, 0.06, 0.9],
  [0.78, 0.23, 0.9],
]

/** Three silk folds in phone units (1200 wide), scaled across for computers: where each lies and how deep it is. */
const FOLDS = [
  { d: 'M-100 860C180 700 500 880 800 640S1140 300 1300 320', top: 320, depth: 620 },
  { d: 'M-100 1010C280 930 560 1080 880 900S1190 660 1300 680', top: 660, depth: 600 },
  { d: 'M-100 1260C340 1150 690 1310 1000 1160S1220 1000 1300 1020', top: 1000, depth: 600 },
]

export function wallpaperSvg(art: WallArt, page: string, light: boolean, wide = false): string {
  const [w, h] = wide ? [2400, 1350] : [1200, 1600]
  // The lamp hangs above the page title and clear of the buttons at the top right.
  const [x, y] = [Math.round(w * (wide ? 0.68 : 0.62)), Math.round(h * (wide ? 0.12 : 0.09))]
  const unit = h / 1600
  const big = Math.max(w, h)
  const r = (n: number) => Math.round(n)
  // A field of color: one radial bloom, strongest at its center and gone at its edge.
  const bloom = (id: string, color: string, cx: number, cy: number, radius: number, strength: number) =>
    `<radialGradient id="${id}" cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity="${strength}"/><stop offset=".45" stop-color="${color}" stop-opacity="${(strength * 0.45).toFixed(3)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
  // The room is cool and the lamp is the one warm thing in it.
  const fields = [
    bloom('f1', art.b2, w * 0.05, h * 0.3, big * 0.6, light ? 0.45 : 0.5),
    bloom('f2', art.b3, w * 1.0, h * 0.75, big * 0.6, light ? 0.4 : 0.55),
    bloom('f3', art.b2, w * 0.35, h * 1.05, big * 0.55, light ? 0.35 : 0.4),
    bloom('f4', art.glow, x, y, big * 0.55, light ? 0.55 : 0.3),
  ]
  // The folds are the room's own colors; the warmth on them is the lamp's light.
  const colors = [art.b1, art.b2, art.b3]
  const body = light ? [0.42, 0.38, 0.36] : [0.62, 0.56, 0.6]
  const foldDefs = FOLDS.map(
    (fold, i) =>
      // The silk's body: bright at its crest, gone before the next fold, so each lies over the dark of the room.
      `<linearGradient id="k${i}" x1="0" y1="${fold.top}" x2="0" y2="${fold.top + fold.depth}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${colors[i]}" stop-opacity="${body[i]}"/><stop offset=".35" stop-color="${colors[i]}" stop-opacity="${(body[i] * 0.45).toFixed(3)}"/><stop offset="1" stop-color="${colors[i]}" stop-opacity="0"/></linearGradient>` +
      // The shade it casts below itself.
      `<linearGradient id="d${i}" x1="0" y1="${fold.top}" x2="0" y2="${fold.top + 260}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="${light ? 0.08 : 0.38}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>` +
      // The same silk where the lamp falls on it: lighter, and only on the lamp's side.
      `<linearGradient id="t${i}" x1="0" y1="${fold.top}" x2="0" y2="${fold.top + fold.depth * 0.7}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${mixHex(colors[i], art.glow, 0.35)}" stop-opacity="${light ? 0.3 : 0.42}"/><stop offset="1" stop-color="${mixHex(colors[i], art.glow, 0.35)}" stop-opacity="0"/></linearGradient>` +
      // The satin sheen just under the edge: a thin band of the lamp's light.
      `<linearGradient id="v${i}" x1="0" y1="${fold.top}" x2="0" y2="${fold.top + 70}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${art.glow}" stop-opacity="${((light ? 0.3 : 0.26) * (1 - i * 0.25)).toFixed(3)}"/><stop offset="1" stop-color="${art.glow}" stop-opacity="0"/></linearGradient>`,
  ).join('')
  const foldShapes = FOLDS.map(
    (fold, i) =>
      `<path fill="url(#d${i})" transform="translate(0 70)" d="${fold.d}V1700H-100Z"/>` +
      `<path fill="url(#k${i})" d="${fold.d}V1700H-100Z"/>` +
      `<path fill="url(#t${i})" mask="url(#side)" d="${fold.d}V1700H-100Z"/>` +
      `<path fill="url(#v${i})" mask="url(#side)" d="${fold.d}V1700H-100Z"/>` +
      `<path fill="none" stroke="url(#e)" stroke-opacity="${(1 - i * 0.22).toFixed(2)}" stroke-width="${(2.4 - i * 0.5).toFixed(1)}" vector-effect="non-scaling-stroke" d="${fold.d}"/>`,
  ).join('')
  const stars = light
    ? ''
    : STARS.map(
        ([sx, sy, size]) =>
          `<circle cx="${r(sx * w)}" cy="${r(sy * h)}" r="${(size * unit * 1.5).toFixed(1)}" fill="#f3eee2" opacity="${size > 1.1 ? 0.4 : 0.24}"/>`,
      ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMin slice">
<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${art.sky}"/><stop offset=".7" stop-color="${page}"/></linearGradient>
${fields.join('')}
<radialGradient id="l" cx="${x}" cy="${y}" r="${r(380 * unit)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff3dc" stop-opacity="${light ? 0.55 : 0.42}"/><stop offset=".22" stop-color="${art.glow}" stop-opacity="${light ? 0.36 : 0.2}"/><stop offset=".6" stop-color="${art.glow}" stop-opacity="${light ? 0.1 : 0.06}"/><stop offset="1" stop-color="${art.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${art.glow}" stop-opacity=".04"/><stop offset=".5" stop-color="${art.glow}" stop-opacity="${light ? 0.35 : 0.3}"/><stop offset="1" stop-color="#fff3dc" stop-opacity="${light ? 0.65 : 0.6}"/></linearGradient>
<linearGradient id="sideg" x1="0" y1="0" x2="1" y2="0"><stop offset=".15" stop-color="#fff" stop-opacity="0"/><stop offset=".9" stop-color="#fff"/></linearGradient>
<mask id="side" maskUnits="userSpaceOnUse" x="-100" y="0" width="1400" height="1700"><rect x="-100" width="1400" height="1700" fill="url(#sideg)"/></mask>
${foldDefs}
<radialGradient id="vig" cx="${r(w * 0.55)}" cy="${r(h * 0.35)}" r="${r(big * 0.8)}" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${light ? 0.1 : 0.4}"/></radialGradient>
<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="url(#s)"/>
${fields.map((_, i) => `<rect width="${w}" height="${h}" fill="url(#f${i + 1})"/>`).join('')}
${stars}
<g transform="scale(${w / 1200} ${unit})">${foldShapes}</g>
<rect width="${w}" height="${h}" fill="url(#l)"/>
<rect width="${w}" height="${h}" fill="url(#vig)"/>
<rect width="${w}" height="${h}" filter="url(#n)" opacity="${light ? 0.04 : 0.05}"/>
</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\n/g, ''))}")`
}

const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
/** `from` moved toward `to` by `amount` (0 to 1). */
export function mixHex(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)
  return `#${a
    .map((value, i) =>
      Math.round(value + (b[i] - value) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Noesis's wallpaper from its page color, the chosen color and the background's own hue: a room of the
 *  background's hue (its colors kept deep, never grayed), lit by the chosen color. */
export function noesisWallpaper(page: string, accent: string, hue: string, wide = false): string {
  return wallpaperSvg(
    {
      sky: mixHex(page, hue, 0.1),
      glow: accent,
      b1: mixHex(mixHex(hue, accent, 0.3), page, 0.42),
      b2: mixHex(hue, page, 0.5),
      b3: mixHex(mixHex(hue, '#8a5cff', 0.25), page, 0.58),
    },
    page,
    false,
    wide,
  )
}
