/*
 * Noesis's icon, drawn on the same system as the Proairetos family's: a 1024 canvas, a tile lit from the top, one
 * solid glyph on shared keylines inside the circle a maskable crop keeps (radius 410). The glyph is the open book
 * with an olive branch from the first logo, redrawn as clean shapes. GLYPH (also used inside the app by NoesisMark)
 * is the single source.
 *
 * Run: node scripts/icons/build.mjs  (needs Playwright's Chromium at /opt/pw-browsers/chromium, or CHROMIUM=path)
 * Writes public/favicon.svg, public/noesis-mark.svg and public/icons/*.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../public')

export const TILE = { top: '#1d3c5e', bottom: '#0b1a2c' }
export const GOLD = '#e2bd76'
export const GOLD_LIGHT = '#f3dcae'

/** An olive leaf from (x, y) at `angle` degrees, as a plain path (no transform, so it can sit anywhere). */
function leaf(x, y, angle, length, width) {
  const r = (angle * Math.PI) / 180
  const at = (along, across) => {
    const px = x + along * Math.cos(r) - across * Math.sin(r)
    const py = y + along * Math.sin(r) + across * Math.cos(r)
    return `${px.toFixed(1)} ${py.toFixed(1)}`
  }
  return `M${at(0, 0)} C${at(length * 0.3, -width)} ${at(length * 0.72, -width)} ${at(length, 0)} C${at(length * 0.72, width)} ${at(length * 0.3, width)} ${at(0, 0)}Z`
}

/** The glyph's shapes on the 1024 canvas: [path, which gold]. The branch rises from the spine. */
export const GLYPH = [
  ['M512 560 C442 518 338 508 248 526 V796 C338 778 442 788 512 828Z', 'light'],
  ['M512 560 C582 518 686 508 776 526 V796 C686 778 582 788 512 828Z', 'gold'],
  ['M504 556 C494 452 520 326 600 196', 'stem'],
  [leaf(502, 470, 200, 118, 36), 'gold'],
  [leaf(512, 400, -20, 118, 36), 'light'],
  [leaf(528, 336, 210, 112, 34), 'light'],
  [leaf(550, 286, -35, 108, 32), 'gold'],
  [leaf(574, 238, 230, 96, 29), 'gold'],
  [leaf(598, 200, -60, 84, 27), 'light'],
]

export function glyphMarkup(gold = GOLD, light = GOLD_LIGHT) {
  return GLYPH.map(([d, kind]) =>
    kind === 'stem'
      ? `<path d="${d}" fill="none" stroke="${gold}" stroke-width="22" stroke-linecap="round"/>`
      : `<path d="${d}" fill="${kind === 'light' ? light : gold}"/>`,
  ).join('')
}

export function iconSvg(shape = 'square') {
  const rx = shape === 'rounded' ? 229 : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="noesis-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TILE.top}"/><stop offset="1" stop-color="${TILE.bottom}"/></linearGradient>
    <radialGradient id="noesis-light" cx="50%" cy="0%" r="75%"><stop offset="0" stop-color="#ffffff" stop-opacity=".12"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <filter id="noesis-lift" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".28"/></filter>
  </defs>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#noesis-tile)"/>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#noesis-light)"/>
  <g filter="url(#noesis-lift)" transform="translate(0 0)">${glyphMarkup()}</g>
</svg>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import('playwright').catch(
    () => import('/opt/node-tools/node_modules/playwright/index.mjs'),
  )
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
  const page = await browser.newPage()
  const png = async (svg, size, file) => {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
    )
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }),
    )
  }
  const rounded = iconSvg('rounded')
  const square = iconSvg('square')
  writeFileSync(join(root, 'favicon.svg'), rounded)
  writeFileSync(join(root, 'noesis-mark.svg'), rounded)
  for (const size of [64, 192, 256, 512]) await png(rounded, size, join(root, 'icons', `icon-${size}.png`))
  await png(square, 512, join(root, 'icons', 'icon-maskable-512.png'))
  await png(square, 180, join(root, 'icons', 'apple-touch-icon.png'))
  await browser.close()
  console.log('Noesis icons written')
}
