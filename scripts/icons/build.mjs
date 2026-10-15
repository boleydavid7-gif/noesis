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

/** The tile: a soft diagonal from deep color (bottom left) to warm light (top right), with two low hills. */
export const TILES = {
  navy: { from: '#13263f', mid: '#3d5d78', to: '#f3cf86', hill: '#0d1c30', hillLight: '#5d7488' },
  green: { from: '#1c4842', mid: '#6f9a6c', to: '#f1d48c', hill: '#163a35', hillLight: '#7da27a' },
}
export const TILE_NAME = process.env.NOESIS_TILE ?? 'navy'
export const CREAM = '#f6eedb'
export const CREAM_SHADE = '#e6d8bb'

/** The glyph on the 1024 canvas: [path, kind]. 'light' is the cream, 'gold' its shade (the lower pages), 'stem' a
 * stroke, 'vein' a cut through a leaf. An open book with two layers of pages, a sprout of two leaves from the spine. */
export const GLYPH = [
  [
    'M151 667 C300 662 452 712 507 812 L512 834 L517 812 C572 712 724 662 873 667 L925 748 C764 745 604 770 518 838 L512 852 L506 838 C420 770 260 745 99 748 Z',
    'gold',
  ],
  ['M231 549 C340 548 458 594 507 790 C430 690 310 640 162 643 Z', 'light'],
  ['M793 549 C684 548 566 594 517 790 C594 690 714 640 862 643 Z', 'light'],
  ['M512 806 C508 700 510 624 518 566', 'stem'],
  ['M528 566 C468 420 566 252 800 196 C792 372 702 512 528 566 Z', 'light'],
  ['M505 568 C428 562 298 500 256 360 C380 356 492 430 505 568 Z', 'light'],
  ['M552 536 C600 448 662 360 744 282', 'vein'],
  ['M486 542 C436 498 368 438 300 392', 'vein'],
]

export function glyphMarkup(tile = TILES[TILE_NAME]) {
  return GLYPH.map(([d, kind]) =>
    kind === 'stem'
      ? `<path d="${d}" fill="none" stroke="${CREAM}" stroke-width="22" stroke-linecap="round"/>`
      : kind === 'vein'
        ? `<path d="${d}" fill="none" stroke="${tile.mid}" stroke-width="13" stroke-linecap="round"/>`
        : `<path d="${d}" fill="${kind === 'light' ? CREAM : CREAM_SHADE}"/>`,
  ).join('')
}

export function iconSvg(shape = 'square', name = TILE_NAME) {
  const tile = TILES[name]
  const rx = shape === 'rounded' ? 229 : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="noesis-tile-${name}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${tile.from}"/><stop offset="0.55" stop-color="${tile.mid}"/><stop offset="1" stop-color="${tile.to}"/></linearGradient>
    <radialGradient id="noesis-light-${name}" cx="78%" cy="18%" r="60%"><stop offset="0" stop-color="#fff6dc" stop-opacity=".45"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></radialGradient>
    <clipPath id="noesis-clip-${name}"><rect width="1024" height="1024" rx="${rx}"/></clipPath>
    <filter id="noesis-lift-${name}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity=".25"/></filter>
  </defs>
  <g clip-path="url(#noesis-clip-${name})">
    <rect width="1024" height="1024" fill="url(#noesis-tile-${name})"/>
    <rect width="1024" height="1024" fill="url(#noesis-light-${name})"/>
    <path d="M0 250 C260 200 460 300 640 470 C760 580 880 640 1024 650 V1024 H0 Z" fill="${tile.hillLight}" opacity=".18"/>
    <path d="M0 560 C220 520 420 600 600 700 C760 790 900 800 1024 760 V1024 H0 Z" fill="${tile.hill}" opacity=".35"/>
    <path d="M0 900 C260 840 520 880 760 950 C860 980 950 990 1024 980 V1024 H0 Z" fill="${tile.hill}" opacity=".35"/>
  </g>
  <g filter="url(#noesis-lift-${name})"><g transform="translate(512 540) scale(1.07) translate(-512 -540)">${glyphMarkup(tile)}</g></g>
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
