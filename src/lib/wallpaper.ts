/** Lamplight's wallpaper: a lamp toward the upper right with rings of light around it, and three bands sweeping
 *  across below. Drawn from a room's colors, so every room has its own; a tall version for phones and a wide
 *  one for computers. The same drawing as Proairetos's Lamplight rooms (its app/wallpaper.ts); here it is made
 *  from the background and color chosen in Settings. */
export type WallArt = {
  sky: string
  glow: string
  b1: string
  b2: string
  b3: string
}

export function wallpaperSvg(art: WallArt, page: string, light: boolean, wide = false): string {
  const [w, h] = wide ? [2400, 1350] : [1200, 1600]
  const [x, y] = [Math.round(w * 0.72), Math.round(h * 0.14)]
  const unit = h / 1600
  const ring = light ? 0.5 : 0.28
  const band = light ? 0.75 : 0.85
  const rings = [190, 300, 430, 590]
    .map(
      (r, i) =>
        `<circle cx="${x}" cy="${y}" r="${Math.round(r * unit)}" stroke-opacity="${(ring * [1, 0.75, 0.5, 0.3][i]).toFixed(3)}"/>`,
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMin slice">
<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${art.sky}"/><stop offset=".8" stop-color="${page}"/></linearGradient>
<radialGradient id="h" cx="${x}" cy="${y}" r="${Math.round(820 * unit)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${art.glow}" stop-opacity="${light ? 0.85 : 0.55}"/><stop offset=".35" stop-color="${art.glow}" stop-opacity="${light ? 0.3 : 0.16}"/><stop offset="1" stop-color="${art.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="l"><stop offset="0" stop-color="#fff" stop-opacity="${light ? 0.85 : 0.6}"/><stop offset=".25" stop-color="${art.glow}" stop-opacity=".9"/><stop offset="1" stop-color="${art.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${art.b1}" stop-opacity="${band}"/><stop offset="1" stop-color="${art.b1}" stop-opacity=".15"/></linearGradient>
<linearGradient id="g2" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${art.b2}" stop-opacity="${band}"/><stop offset="1" stop-color="${art.b2}" stop-opacity=".2"/></linearGradient>
<linearGradient id="g3" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${art.b3}" stop-opacity=".9"/><stop offset="1" stop-color="${art.b3}" stop-opacity=".5"/></linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#s)"/>
<rect width="${w}" height="${h}" fill="url(#h)"/>
<g fill="none" stroke="${art.glow}" stroke-width="3">${rings}</g>
<circle cx="${x}" cy="${y}" r="${Math.round(130 * unit)}" fill="url(#l)"/>
<g transform="scale(${w / 1200} ${unit})">
<path fill="url(#g1)" d="M-100 560C240 400 540 740 840 560S1170 360 1300 440V820C1010 720 760 960 430 900S40 780-100 860Z"/>
<path fill="url(#g2)" d="M-100 780C200 660 470 940 800 820S1150 640 1300 720V1060C1000 960 780 1160 430 1100S60 980-100 1060Z"/>
<path fill="url(#g3)" d="M-100 1000C260 880 560 1160 880 1030S1180 880 1300 950V1700H-100Z"/>
</g>
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

/** Noesis's wallpaper from its page color, the chosen color and the background's own hue. */
export function noesisWallpaper(page: string, accent: string, hue: string, wide = false): string {
  return wallpaperSvg(
    {
      sky: mixHex(mixHex(page, hue, 0.18), '#ffffff', 0.05),
      glow: accent,
      b1: mixHex(accent, page, 0.45),
      b2: mixHex(hue, page, 0.55),
      b3: mixHex(page, '#ffffff', 0.05),
    },
    page,
    false,
    wide,
  )
}
