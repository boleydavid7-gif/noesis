// Noesis's pictures as flat drawn scenes, in the Proairetos family's style (engine.mjs is its kit in a richer cut:
// one light at LAMP_X with its ring, lit ridge tops, soft mist, drawn at twice the size): the default reading view (a lake at sunset seen from a sill with an open book) and the choosable scenes, at the
// same names and sizes as the photos they replaced.
// Run: node scripts/scenes/noesis.mjs   (Playwright's Chromium at /opt/pw-browsers/chromium or CHROMIUM=path; ffmpeg)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAMP_X,
  firsOn,
  glow,
  lamp,
  lampRing,
  landscape,
  mist,
  rng,
  ridgeFn,
  ridgePath,
  sky,
  stars,
  svg,
  water,
} from './engine.mjs'

const pub = join(dirname(fileURLToPath(import.meta.url)), '../../public')

// ---------- Pieces ----------

/** A row of buildings standing on `base` (as a share of the height), some windows lit. */
function skyline(w, h, base, seed, { color, height = 0.2, minW = 0.03, maxW = 0.075, lit = 0, litColor = '#ffd98a' }) {
  const r = rng(seed)
  let body = ''
  let win = ''
  let x = -w * 0.02
  const cell = Math.max(3, h * 0.011)
  while (x < w) {
    const bw = Math.max(w, h * 0.9) * (minW + r() * (maxW - minW))
    const bh = h * height * (0.35 + r() * 0.75)
    const top = h * base - bh
    body += `M${x.toFixed(1)},${h} L${x.toFixed(1)},${top.toFixed(1)} L${(x + bw).toFixed(1)},${top.toFixed(1)} L${(x + bw).toFixed(1)},${h} Z `
    if (r() < 0.3) {
      const sw = bw * (0.5 + r() * 0.3)
      const sx = x + (bw - sw) / 2
      const sh = Math.min(bh * (0.06 + r() * 0.08), h * 0.03)
      body += `M${sx.toFixed(1)},${top} L${sx.toFixed(1)},${(top - sh).toFixed(1)} L${(sx + sw).toFixed(1)},${(top - sh).toFixed(1)} L${(sx + sw).toFixed(1)},${top} Z `
      const mast = Math.min(bh * 0.08, h * 0.025)
      const mw = Math.max(1.5, w * 0.003)
      if (r() < 0.35)
        body += `M${(sx + sw / 2 - mw).toFixed(1)},${top - sh} L${(sx + sw / 2 - mw).toFixed(1)},${(top - sh - mast).toFixed(1)} L${(sx + sw / 2 + mw).toFixed(1)},${(top - sh - mast).toFixed(1)} L${(sx + sw / 2 + mw).toFixed(1)},${top - sh} Z `
    }
    if (lit) {
      const cols = Math.max(1, Math.floor((bw - cell) / (cell * 2.2)))
      const rows = Math.floor((h * base - top - cell) / (cell * 2.6))
      for (let cx = 0; cx < cols; cx++)
        for (let ry = 0; ry < rows; ry++)
          if (r() < lit)
            win += `<rect x="${(x + cell + cx * cell * 2.2).toFixed(1)}" y="${(top + cell + ry * cell * 2.6).toFixed(1)}" width="${cell.toFixed(1)}" height="${(cell * 1.3).toFixed(1)}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`
    }
    x += bw
  }
  return `<path d="${body}" fill="${color}"/><g fill="${litColor}">${win}</g>`
}

/** Window lights repeated on water as soft vertical streaks. */
function lightsOnWater(w, h, y, seed, n, color) {
  const r = rng(seed)
  let s = ''
  for (let i = 0; i < n; i++) {
    const x = r() * w
    const len = (h - y) * (0.15 + r() * 0.45)
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1.5, w * 0.002).toFixed(1)}" height="${len.toFixed(1)}" fill="${color}" opacity="${(0.12 + r() * 0.25).toFixed(2)}"/>`
  }
  return s
}

/** A small cabin with a lit window, chimney and a thread of smoke. */
function cabin(x, y, s, { wall, roof, light, smoke = '#ffffff' }) {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(3)})">
    <circle cx="6" cy="-14" r="34" fill="${light}" opacity="0.18" filter="url(#glowblur)"/>
    <path d="M-30,0 L-30,-24 L30,-24 L30,0 Z" fill="${wall}"/>
    <path d="M-36,-22 L0,-48 L36,-22 Z" fill="${roof}"/>
    <path d="M14,-40 L14,-50 L21,-50 L21,-35 Z" fill="${roof}"/>
    <rect x="-4" y="-17" width="13" height="10" fill="${light}"/>
    <rect x="-22" y="-15" width="9" height="15" fill="${light}" opacity="0.55"/>
    <path d="M17,-52 C12,-62 24,-68 18,-78 C13,-86 24,-92 20,-100" stroke="${smoke}" stroke-width="3" fill="none" opacity="0.22" stroke-linecap="round"/>
  </g>`
}

/** The reading view's foreground: a dark sill with an open book and a mug. */
function sill(w, h) {
  const m = Math.min(w, h)
  const top = h * 0.84
  const bx = w * 0.42
  const bw = m * 0.42
  const by = top + h * 0.035
  const page = (dir) =>
    `M${bx},${by} C${bx + dir * bw * 0.18},${by - m * 0.05} ${bx + dir * bw * 0.36},${by - m * 0.05} ${bx + dir * bw * 0.5},${by - m * 0.03} L${bx + dir * bw * 0.52},${by + m * 0.025} C${bx + dir * bw * 0.36},${by + m * 0.005} ${bx + dir * bw * 0.18},${by + m * 0.005} ${bx},${by + m * 0.035} Z`
  const lines = (dir) =>
    Array.from({ length: 5 }, (_, i) => {
      const yy = by - m * 0.022 + i * m * 0.009
      return `<path d="M${bx + dir * bw * 0.08},${yy + m * 0.012} C${bx + dir * bw * 0.22},${yy - m * 0.006} ${bx + dir * bw * 0.34},${yy - m * 0.006} ${bx + dir * bw * 0.44},${yy + m * 0.002}" stroke="#b7a68a" stroke-width="${Math.max(1, m * 0.002)}" fill="none" opacity="0.5"/>`
    }).join('')
  const mx = w * 0.78
  const mw = m * 0.07
  const mh = m * 0.08
  const base = top + h * 0.035
  const lampX = w * LAMP_X
  return `
  <defs>
    <linearGradient id="sillg" x1="0" y1="${top}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#22180f"/><stop offset="1" stop-color="#0d0907"/></linearGradient>
    <linearGradient id="silledge" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a2b1d"/><stop offset="${(lampX / w).toFixed(3)}" stop-color="#8a6a44"/><stop offset="1" stop-color="#3a2b1d"/></linearGradient>
    <linearGradient id="pageL" x1="${bx - bw * 0.5}" y1="0" x2="${bx}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#eadcc0"/><stop offset=".8" stop-color="#d8c6a2"/><stop offset="1" stop-color="#b8a27c"/></linearGradient>
    <linearGradient id="pageR" x1="${bx}" y1="0" x2="${bx + bw * 0.5}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#bba57f"/><stop offset=".2" stop-color="#e4d4b4"/><stop offset="1" stop-color="#f6ebd4"/></linearGradient>
    <linearGradient id="mugg" x1="${mx - mw / 2}" y1="0" x2="${mx + mw / 2}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2a1f17"/><stop offset=".55" stop-color="#4a3829"/><stop offset=".8" stop-color="#6d5238"/><stop offset="1" stop-color="#33261c"/></linearGradient>
    <radialGradient id="pool" cx="${bx}" cy="${by}" r="${bw * 0.9}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffcf86" stop-opacity=".16"/><stop offset="1" stop-color="#ffcf86" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="0" y="${top}" width="${w}" height="${h - top}" fill="url(#sillg)"/>
  <rect x="0" y="${top}" width="${w}" height="${Math.max(2, h * 0.004)}" fill="url(#silledge)"/>
  <rect x="0" y="${top}" width="${w}" height="${h - top}" fill="url(#pool)"/>
  <ellipse cx="${bx}" cy="${by + m * 0.042}" rx="${bw * 0.62}" ry="${m * 0.014}" fill="#000" opacity="0.5" filter="url(#soft)"/>
  <path d="${page(-1)}" fill="url(#pageL)"/><path d="${page(1)}" fill="url(#pageR)"/>${lines(-1)}${lines(1)}
  <path d="${page(1)}" fill="none" stroke="#fff6e0" stroke-opacity="0.35" stroke-width="${Math.max(1, m * 0.0018)}"/>
  <path d="M${bx},${by - m * 0.002} L${bx},${by + m * 0.035}" stroke="#7d6a4f" stroke-width="${Math.max(1, m * 0.003)}"/>
  <ellipse cx="${mx + mw * 0.1}" cy="${base + m * 0.004}" rx="${mw * 0.75}" ry="${m * 0.008}" fill="#000" opacity="0.45" filter="url(#soft)"/>
  <rect x="${mx - mw / 2}" y="${base - mh}" width="${mw}" height="${mh}" rx="${mw * 0.14}" fill="url(#mugg)"/>
  <ellipse cx="${mx}" cy="${base - mh}" rx="${mw / 2}" ry="${mw * 0.09}" fill="#1a120c"/>
  <path d="M${mx - mw * 0.2},${base - mh - mw * 0.06} A${mw / 2} ${mw * 0.09} 0 0 0 ${mx + mw / 2},${base - mh}" stroke="#c7a173" stroke-opacity="0.5" stroke-width="${Math.max(1, m * 0.0018)}" fill="none"/>
  <path d="M${mx + mw / 2},${base - mh * 0.75} C${mx + mw},${base - mh * 0.75} ${mx + mw},${base - mh * 0.25} ${mx + mw / 2},${base - mh * 0.25}" stroke="#4a3829" stroke-width="${mw * 0.16}" fill="none"/>
  <path d="M${mx - mw * 0.1},${base - mh * 1.1} C${mx - mw * 0.3},${top - mh * 1.6} ${mx + mw * 0.2},${top - mh * 1.9} ${mx},${top - mh * 2.5}" stroke="#f3e2c4" stroke-width="${Math.max(1.5, m * 0.004)}" fill="none" opacity="0.16" stroke-linecap="round" filter="url(#rimblur)"/>`
}

// ---------- Scenes ----------

const reading = (w, h) =>
  landscape(w, h, {
    sky: [
      [0, '#131a30'],
      [0.22, '#2c3354'],
      [0.4, '#8b5c58'],
      [0.5, '#e39b5c'],
      [0.56, '#f5c27b'],
    ],
    sun: [0.66, 0.5],
    sunR: 0.03,
    glowColor: '#ffcf86',
    glowSize: 0.55,
    ridges: [
      { base: 0.5, amp: 0.04, seed: 4, detail: 1.3, peaks: 4, color: '#86677c' },
      { base: 0.55, amp: 0.03, seed: 9, color: '#58486a', mistBefore: ['#f2c08a', 0.25] },
      {
        base: 0.6,
        amp: 0.025,
        seed: 14,
        color: '#363552',
        firs: { size: 0.022, count: 70 },
        waterAfter: {
          y: 0.62,
          stops: [
            [0, '#d99a6a'],
            [0.35, '#6a4f62'],
            [1, '#1d1d30'],
          ],
          glint: '#ffd59a',
          reflect: '#36345a',
        },
      },
    ],
    after: (w2, h2) => sill(w2, h2),
  })

const cityNight = (w, h) => {
  const y = h * 0.84
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>${stars(w, h, 5, Math.round((w * h) / 2600), 0.55)}
  ${lamp(w * LAMP_X, h * 0.18, Math.min(w, h), 0.032, '#f2eee4', '#cfdcf2')}
  <rect width="${w}" height="${h}" fill="url(#cityglow)"/>
  ${skyline(w, h, 0.84, 11, { color: '#1c2744', height: 0.42, lit: 0.06, litColor: '#9fb7e6' })}
  ${skyline(w, h, 0.86, 23, { color: '#0d1326', height: 0.3, minW: 0.05, maxW: 0.11, lit: 0.22 })}
  ${water(
    w,
    h,
    y + h * 0.02,
    [
      [0, '#18233f'],
      [1, '#05080f'],
    ],
    w * LAMP_X,
    null,
    7,
  )}
  ${lightsOnWater(w, h, y + h * 0.02, 31, Math.round(w / 14), '#ffd98a')}`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#05080f'],
      [0.5, '#111a33'],
      [0.85, '#24345a'],
    ]) + glow('cityglow', w * 0.5, h * 0.86, Math.max(w, h) * 0.6, '#ff9f5a', 0.25),
    body,
  )
}

const citySunset = (w, h) => {
  const y = h * 0.86
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/><rect width="${w}" height="${h}" fill="url(#sunglow)"/>
  ${lamp(w * LAMP_X, h * 0.62, Math.min(w, h), 0.045, '#ffe2a8', '#ffcf86')}
  ${skyline(w, h, 0.84, 41, { color: '#7a4f60', height: 0.4 })}
  ${mist(w, h * 0.76, h * 0.06, '#f4b07a', 0.25)}
  ${skyline(w, h, 0.87, 47, { color: '#2a1b2b', height: 0.28, minW: 0.05, maxW: 0.1, lit: 0.06, litColor: '#ffcf86' })}
  ${water(
    w,
    h,
    y,
    [
      [0, '#c77a5c'],
      [0.4, '#5a3346'],
      [1, '#160f1c'],
    ],
    w * LAMP_X,
    '#ffd59a',
    9,
  )}`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#2a2347'],
      [0.35, '#8a4b63'],
      [0.6, '#ea8a5a'],
      [0.72, '#f7c278'],
    ]) + glow('sunglow', w * LAMP_X, h * 0.62, Math.max(w, h) * 0.6, '#ffcf86', 0.8),
    body,
  )
}

const duskCity = (w, h) => {
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>${stars(w, h, 13, Math.round((w * h) / 6000), 0.35)}<rect width="${w}" height="${h}" fill="url(#sunglow)"/>${lampRing(w * LAMP_X, h * 0.72, Math.min(w, h), '#ffb38a', 0.18)}
  ${skyline(w, h, 0.8, 53, { color: '#4a3a66', height: 0.38, lit: 0.05, litColor: '#f1c6e0' })}
  ${skyline(w, h, 0.84, 59, { color: '#1f1833', height: 0.3, minW: 0.06, maxW: 0.12, lit: 0.16, litColor: '#ffd59a' })}
  <rect x="0" y="${h * 0.84}" width="${w}" height="${h * 0.16}" fill="#120e1f"/>
  ${Array.from({ length: 9 }, (_, i) => `<circle cx="${(w * (0.06 + i * 0.11)).toFixed(1)}" cy="${(h * 0.875).toFixed(1)}" r="${Math.max(2, w * 0.006)}" fill="#ffd59a"/><circle cx="${(w * (0.06 + i * 0.11)).toFixed(1)}" cy="${(h * 0.875).toFixed(1)}" r="${Math.max(6, w * 0.02)}" fill="#ffd59a" opacity="0.15"/>`).join('')}`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#16132e'],
      [0.45, '#4b3767'],
      [0.75, '#c4789a'],
      [0.85, '#f0a98e'],
    ]) + glow('sunglow', w * LAMP_X, h * 0.8, Math.max(w, h) * 0.6, '#ffb38a', 0.5),
    body,
  )
}

const sunriseCity = (w, h) => {
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/><rect width="${w}" height="${h}" fill="url(#sunglow)"/>
  ${lamp(w * LAMP_X, h * 0.66, Math.min(w, h), 0.045, '#fff4d6', '#fff0c4')}
  ${skyline(w, h, 0.8, 61, { color: '#93a3bf', height: 0.42 })}
  ${mist(w, h * 0.7, h * 0.08, '#fff0d4', 0.45)}
  ${skyline(w, h, 0.85, 67, { color: '#4a5878', height: 0.3, minW: 0.05, maxW: 0.11, lit: 0.04, litColor: '#ffe7b0' })}
  ${mist(w, h * 0.82, h * 0.06, '#ffe6c4', 0.35)}
  <rect x="0" y="${h * 0.88}" width="${w}" height="${h * 0.12}" fill="#2c3550"/>`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#6f93c4'],
      [0.4, '#b9c9de'],
      [0.62, '#f3d8b0'],
      [0.72, '#fbe6c2'],
    ]) + glow('sunglow', w * LAMP_X, h * 0.66, Math.max(w, h) * 0.6, '#fff0c4', 0.85),
    body,
  )
}

const cabinScene = (w, h) =>
  landscape(w, h, {
    sky: [
      [0, '#2c3a62'],
      [0.3, '#8e7aa0'],
      [0.48, '#f0a98e'],
      [0.56, '#fbd3a2'],
    ],
    sun: [0.3, 0.52],
    sunR: 0.03,
    glowColor: '#ffd9b0',
    glowSize: 0.55,
    ridges: [
      { base: 0.5, amp: 0.05, seed: 7, detail: 1.2, peaks: 5, color: '#9a86a6' },
      { base: 0.58, amp: 0.03, seed: 12, color: '#6d6688', mistBefore: ['#ffd9c0', 0.35] },
      { base: 0.66, amp: 0.03, seed: 19, color: '#45506a', firs: { size: 0.03, count: 60 } },
      { base: 0.76, amp: 0.02, seed: 26, color: '#2d3a4a', mistBefore: ['#f6c7a8', 0.2] },
      { base: 0.88, amp: 0.02, seed: 33, color: '#1a2330', firs: { size: 0.07, count: 14 } },
    ],
    after: (w2, h2, fns) =>
      cabin(w2 * 0.34, fns[3](w2 * 0.34) + h2 * 0.006, Math.min(w2, h2) / 260, {
        wall: '#1e2735',
        roof: '#151c27',
        light: '#ffcf7a',
      }),
  })

const winterFire = (w, h) => {
  const r = rng(77)
  const snow = Array.from(
    { length: Math.round((w * h) / 3500) },
    () =>
      `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(0.8 + r() * 1.8).toFixed(1)}" fill="#fff" opacity="${(0.25 + r() * 0.5).toFixed(2)}"/>`,
  ).join('')
  return landscape(w, h, {
    sky: [
      [0, '#070b17'],
      [0.45, '#18233f'],
      [0.62, '#3a4a6c'],
    ],
    sun: [0.5, 0.7],
    glowColor: '#9fb3d6',
    glowSize: 0.4,
    glowStrength: 0.35,
    stars: { seed: 4, density: 3500, maxY: 0.45 },
    moon: [0.22, 0.16, 0.04],
    moonSky: '#0c1324',
    ridges: [
      { base: 0.52, amp: 0.05, seed: 6, detail: 1.2, peaks: 4, color: '#8ea2c2' },
      { base: 0.6, amp: 0.03, seed: 15, color: '#c4d2e4', firs: { size: 0.028, count: 50, color: '#1c2a42' } },
      { base: 0.72, amp: 0.025, seed: 22, color: '#dbe5f0', firs: { size: 0.05, count: 24, color: '#16223a' } },
      { base: 0.86, amp: 0.02, seed: 30, color: '#eef3f8' },
    ],
    after: (w2, h2, fns) =>
      cabin(w2 * 0.4, fns[2](w2 * 0.4) + h2 * 0.008, Math.min(w2, h2) / 220, {
        wall: '#26314a',
        roof: '#e9eff6',
        light: '#ffb45e',
      }) + snow,
  })
}

const reef = (w, h) => {
  const r = rng(91)
  const rays = Array.from({ length: 7 }, (_, i) => {
    const x = w * (0.05 + i * 0.15 + r() * 0.05)
    return `<path d="M${x},0 L${x + w * 0.06},0 L${x + w * 0.22},${h * 0.75} L${x + w * 0.1},${h * 0.75} Z" fill="#dff7f6" opacity="${(0.04 + r() * 0.05).toFixed(2)}" filter="url(#soft)"/>`
  }).join('')
  // Rounded coral clumps: a few overlapping domes, and fans of short thick branches.
  const clump = (x, base, size, color, seed) => {
    const rr = rng(seed)
    let c = ''
    for (let k = 0; k < 5; k++) {
      const cx = x + (rr() - 0.5) * size * 1.6
      const rad = size * (0.35 + rr() * 0.35)
      c += `<ellipse cx="${cx.toFixed(1)}" cy="${(base - rad * 0.55).toFixed(1)}" rx="${rad.toFixed(1)}" ry="${(rad * 0.8).toFixed(1)}" fill="${color}"/>`
    }
    return c
  }
  const fan = (x, base, size, color, seed) => {
    const rr = rng(seed)
    let d = ''
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.28 + (rr() - 0.5) * 0.1
      const len = size * (0.7 + rr() * 0.4)
      d += `M${x},${base} Q${(x + Math.cos(a) * len * 0.5 + (rr() - 0.5) * size * 0.2).toFixed(1)},${(base + Math.sin(a) * len * 0.5).toFixed(1)} ${(x + Math.cos(a) * len).toFixed(1)},${(base + Math.sin(a) * len).toFixed(1)} `
    }
    return `<path d="${d}" stroke="${color}" stroke-width="${Math.max(4, size * 0.13)}" stroke-linecap="round" fill="none"/>`
  }
  const coral = (x, base, size, color, seed) =>
    seed % 2 ? fan(x, base, size, color, seed) : clump(x, base, size * 0.6, color, seed)
  const bed = ridgeFn(w, h, 0.86, 0.025, 93, 0.8)
  const fish = Array.from({ length: 14 }, () => {
    const x = w * (0.15 + r() * 0.65),
      y = h * (0.28 + r() * 0.22),
      s = Math.min(w, h) * (0.022 + r() * 0.012)
    return `<path d="M${x},${y} q${s * 1.2},${-s * 0.7} ${s * 2.2},0 q${-s},${s * 0.7} ${-s * 2.2},0 Z M${x + s * 2.2},${y} l${s * 0.7},${-s * 0.5} l0,${s} Z" fill="#c7ecef" opacity="0.5"/>`
  }).join('')
  const bubbles = Array.from(
    { length: 18 },
    () =>
      `<circle cx="${(w * (0.6 + r() * 0.3)).toFixed(1)}" cy="${(h * (0.2 + r() * 0.6)).toFixed(1)}" r="${(1.5 + r() * 4).toFixed(1)}" fill="none" stroke="#e4fbfb" stroke-opacity="0.35"/>`,
  ).join('')
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>${rays}${fish}${bubbles}
  ${coral(w * 0.18, h * 0.88, h * 0.09, '#2f6f7c', 3)}${coral(w * 0.8, h * 0.9, h * 0.1, '#2f6f7c', 5)}
  <path d="${ridgePath(w, h, bed)}" fill="#123a4c"/>
  ${coral(w * 0.12, h * 0.95, h * 0.1, '#b9716a', 4)}${coral(w * 0.38, h * 0.96, h * 0.12, '#d08a6a', 7)}
  ${coral(w * 0.62, h * 0.95, h * 0.1, '#a8607a', 6)}${coral(w * 0.86, h * 0.97, h * 0.12, '#c9806c', 9)}
  <path d="${ridgePath(w, h, ridgeFn(w, h, 0.95, 0.015, 97, 0.6))}" fill="#08202c"/>`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#5cc0c4'],
      [0.25, '#2b8aa0'],
      [0.6, '#11506e'],
      [1, '#062436'],
    ]),
    body,
  )
}

const moonBeach = (w, h) => {
  const m = Math.min(w, h)
  const sea = h * 0.6
  const shore = ridgeFn(w, h, 0.82, 0.02, 101, 0.6)
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>${stars(w, h, 17, Math.round((w * h) / 2200), 0.5)}
  <rect width="${w}" height="${h}" fill="url(#moonglow)"/>
  ${lamp(w * LAMP_X, h * 0.24, m, 0.06, '#f3ecd9', '#cfdcf2')}
  ${water(
    w,
    h,
    sea,
    [
      [0, '#2a3c62'],
      [0.5, '#16223e'],
      [1, '#0a111f'],
    ],
    w * LAMP_X,
    '#f3ecd9',
    11,
  )}
  ${Array.from({ length: 4 }, (_, i) => `<path d="${ridgePath(w, h, ridgeFn(w, h, 0.78 + i * 0.012, 0.006, 103 + i, 1.4))}" fill="none" stroke="#dfe7f3" stroke-opacity="${0.12 + i * 0.05}" stroke-width="${Math.max(1.5, h * 0.002)}"/>`).join('')}
  <path d="${ridgePath(w, h, shore)}" fill="#8f8a84"/>
  <path d="${ridgePath(w, h, ridgeFn(w, h, 0.9, 0.025, 107, 0.7))}" fill="#5e5a5c"/>`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#060a16'],
      [0.45, '#152245'],
      [0.6, '#2c3d66'],
    ]) + glow('moonglow', w * LAMP_X, h * 0.24, Math.max(w, h) * 0.5, '#cfdcf2', 0.35),
    body,
  )
}

const sunsetBeach = (w, h) => {
  const sea = h * 0.6
  const r = rng(113)
  const grass = Array.from({ length: Math.round(w / 9) }, () => {
    const x = r() * w * 0.45,
      b = h * (0.9 + r() * 0.06),
      t = h * (0.04 + r() * 0.05)
    return `M${x.toFixed(1)},${b.toFixed(1)} q${((r() - 0.5) * t * 0.6).toFixed(1)},${(-t / 2).toFixed(1)} ${((r() - 0.3) * t * 0.8).toFixed(1)},${(-t).toFixed(1)} `
  }).join('')
  const body = `<rect width="${w}" height="${h}" fill="url(#sky)"/><rect width="${w}" height="${h}" fill="url(#sunglow)"/>
  ${lamp(w * LAMP_X, sea, Math.min(w, h), 0.06, '#ffe1a2', '#ffcf86')}
  ${water(
    w,
    h,
    sea,
    [
      [0, '#e8946a'],
      [0.4, '#8a4f5e'],
      [1, '#2a1c2c'],
    ],
    w * LAMP_X,
    '#ffd99a',
    13,
  )}
  <path d="${ridgePath(w, h, ridgeFn(w, h, 0.84, 0.02, 117, 0.6))}" fill="#c99a76"/>
  <path d="${ridgePath(w, h, ridgeFn(w, h, 0.93, 0.03, 119, 0.7))}" fill="#7a5a52"/>
  <path d="${grass}" stroke="#4a3436" stroke-width="${Math.max(1.5, w / 400)}" fill="none" stroke-linecap="round"/>`
  return svg(
    w,
    h,
    sky('sky', [
      [0, '#2c2550'],
      [0.3, '#8a4f78'],
      [0.5, '#ef8f62'],
      [0.6, '#fbc37a'],
    ]) + glow('sunglow', w * LAMP_X, sea, Math.max(w, h) * 0.6, '#ffcf86', 0.85),
    body,
  )
}

const mistyPines = (w, h) =>
  landscape(w, h, {
    sky: [
      [0, '#55636f'],
      [0.4, '#9aa8ae'],
      [0.6, '#d6dcd8'],
    ],
    sun: [0.7, 0.3],
    glowColor: '#f2efe2',
    glowSize: 0.5,
    glowStrength: 0.5,
    ridges: [
      { base: 0.42, amp: 0.03, seed: 5, color: '#a8b4b2', firs: { size: 0.03, count: 40 } },
      {
        base: 0.52,
        amp: 0.03,
        seed: 11,
        color: '#7f9290',
        firs: { size: 0.045, count: 30 },
        mistBefore: ['#eef1ec', 0.6],
      },
      {
        base: 0.64,
        amp: 0.03,
        seed: 17,
        color: '#55696a',
        firs: { size: 0.07, count: 22 },
        mistBefore: ['#eef1ec', 0.55],
      },
      {
        base: 0.78,
        amp: 0.03,
        seed: 23,
        color: '#33453f',
        firs: { size: 0.11, count: 14 },
        mistBefore: ['#e6ebe4', 0.5],
      },
      { base: 0.92, amp: 0.02, seed: 29, color: '#1d2a25', firs: { size: 0.16, count: 8 } },
    ],
  })

const forest = (w, h) => {
  const stream = (x0, top, x1) =>
    `M${w * x0 - w * 0.02},${h * top} C${w * 0.42},${h * 0.72} ${w * 0.62},${h * 0.8} ${w * x1 - w * 0.2},${h} L${w * x1 + w * 0.2},${h} C${w * 0.72},${h * 0.8} ${w * 0.5},${h * 0.72} ${w * x0 + w * 0.02},${h * top} Z`
  return landscape(w, h, {
    sky: [
      [0, '#2f4a46'],
      [0.35, '#8fae9a'],
      [0.55, '#e9ecc8'],
    ],
    sun: [0.52, 0.4],
    sunR: 0.025,
    glowColor: '#fbf2c6',
    glowSize: 0.45,
    ridges: [
      {
        base: 0.5,
        amp: 0.03,
        seed: 8,
        color: '#7f9f8a',
        firs: { size: 0.04, count: 50 },
        mistBefore: ['#f4f1d6', 0.45],
      },
      {
        base: 0.6,
        amp: 0.035,
        seed: 16,
        color: '#4f7362',
        firs: { size: 0.07, count: 30 },
        mistBefore: ['#eef0d6', 0.4],
      },
    ],
    after: (w2, h2) => {
      const left = (x) => h2 * (0.66 + 0.18 * Math.max(0, 0.42 - x / w2))
      const right = (x) => h2 * (0.66 + 0.18 * Math.max(0, x / w2 - 0.6))
      return `<path d="M0,${h2} L0,${h2 * 0.64} L${w2},${h2 * 0.64} L${w2},${h2} Z" fill="#2c4a3c"/>
      <path d="${stream(0.5, 0.64, 0.5)}" fill="#cfe0cf" opacity="0.85"/>
      <path d="${stream(0.5, 0.66, 0.5)}" fill="#7fa597" opacity="0.6"/>
      <path d="${firsOn(w2 * 0.4, left, 131, h2 * 0.16, 9)}" fill="#1d3329"/>
      <path d="${firsOn(w2, (x) => (x > w2 * 0.62 ? right(x) : h2 * 2), 137, h2 * 0.16, 16)}" fill="#1d3329"/>
      <path d="${ridgePath(w2, h2, ridgeFn(w2, h2, 0.95, 0.02, 139, 0.6))}" fill="#14241d"/>`
    },
  })
}

// ---------- Files ----------

const FILES = [
  ['noesis-hero.jpg', reading, 1800, 1050],
  ['noesis-header.webp', reading, 1400, 788],
  ['noesis-sidebar.webp', reading, 512, 1280],
  ['scenes/city-night-wide.webp', cityNight, 1600, 900],
  ['scenes/city-night-tall.webp', cityNight, 560, 1120],
  ['scenes/cabin-wide.webp', cabinScene, 1600, 900],
  ['scenes/cabin-tall.webp', cabinScene, 560, 1120],
  ['scenes/winter-fire-wide.webp', winterFire, 1600, 900],
  ['scenes/winter-fire-tall.webp', winterFire, 560, 1120],
  ['scenes/city-sunset-wide.webp', citySunset, 1600, 900],
  ['scenes/city-sunset-tall.webp', citySunset, 560, 1120],
  ['scenes/reef-tall.webp', reef, 560, 1120],
  ['scenes/moon-beach-tall.webp', moonBeach, 560, 1120],
  ['scenes/dusk-city-tall.webp', duskCity, 560, 1120],
  ['scenes/misty-pines-tall.webp', mistyPines, 560, 1120],
  ['scenes/sunset-beach-tall.webp', sunsetBeach, 560, 1120],
  ['scenes/sunrise-city-tall.webp', sunriseCity, 560, 1120],
  ['scenes/forest-wide.webp', forest, 1600, 900],
  ['scenes/forest-tall.webp', forest, 560, 1120],
]

const only = process.argv[2]
const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
// Drawn at twice the size and scaled down, so every edge is smooth.
const page = await browser.newPage({ deviceScaleFactor: 2 })
const tmp = mkdtempSync(join(tmpdir(), 'noesis-scenes-'))
for (const [file, draw, w, h] of FILES) {
  if (only && !file.includes(only)) continue
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0">${draw(w, h)}</body></html>`)
  const target = join(pub, file)
  const png = join(tmp, 'x.png')
  await page.screenshot({ path: png })
  const scale = ['-vf', `scale=${w}:${h}:flags=lanczos`]
  if (file.endsWith('.jpg'))
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, ...scale, '-q:v', '3', target])
  else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, ...scale, '-quality', '86', target])
  console.log('drawn', file)
}
rmSync(tmp, { recursive: true, force: true })
await browser.close()
