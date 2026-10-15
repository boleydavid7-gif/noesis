/*
 * Noesis Notes's icon, on Noesis's system (scripts/icons/build.mjs): the same lit tile, in the green variant so the two
 * apps sit together but are told apart, and one cream glyph: a page with a folded corner, ruled lines, and Noesis's
 * sprout growing from its edge.
 *
 * Run: node scripts/icons/notes.mjs  (Playwright's Chromium, as for build.mjs)
 * Writes public/notes/favicon.svg and public/notes/icons/*.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CREAM, CREAM_SHADE, TILES } from './build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../public/notes')
const tile = TILES.green

// A page (left edge straight, folded top-right corner), three ruled lines, and two leaves from the page's top.
const glyph = () => `
  <path d="M300 300 H640 L740 400 V800 C740 822 722 840 700 840 H300 C278 840 260 822 260 800 V340 C260 318 278 300 300 300 Z" fill="${CREAM}"/>
  <path d="M640 300 V372 C640 388 652 400 668 400 H740 Z" fill="${CREAM_SHADE}"/>
  <path d="M330 520 H668 M330 616 H668 M330 712 H560" stroke="${tile.mid}" stroke-width="26" stroke-linecap="round"/>
  <path d="M420 318 C410 250 430 196 470 150" fill="none" stroke="${CREAM}" stroke-width="20" stroke-linecap="round"/>
  <path d="M470 160 C470 90 540 52 640 52 C632 140 568 186 470 160 Z" fill="${CREAM}"/>
  <path d="M432 214 C380 216 320 190 296 128 C356 122 420 150 432 214 Z" fill="${CREAM}"/>
  <path d="M486 150 C530 120 568 100 610 82" fill="none" stroke="${tile.mid}" stroke-width="10" stroke-linecap="round"/>`

export function notesIconSvg(shape = 'square') {
  const rx = shape === 'rounded' ? 229 : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="notes-tile" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${tile.from}"/><stop offset="0.55" stop-color="${tile.mid}"/><stop offset="1" stop-color="${tile.to}"/></linearGradient>
    <radialGradient id="notes-light" cx="78%" cy="18%" r="60%"><stop offset="0" stop-color="#fff6dc" stop-opacity=".45"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></radialGradient>
    <clipPath id="notes-clip"><rect width="1024" height="1024" rx="${rx}"/></clipPath>
    <filter id="notes-lift" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity=".25"/></filter>
  </defs>
  <g clip-path="url(#notes-clip)">
    <rect width="1024" height="1024" fill="url(#notes-tile)"/>
    <rect width="1024" height="1024" fill="url(#notes-light)"/>
    <path d="M0 560 C220 520 420 600 600 700 C760 790 900 800 1024 760 V1024 H0 Z" fill="${tile.hill}" opacity=".35"/>
  </g>
  <g filter="url(#notes-lift)"><g transform="translate(512 512) scale(0.88) translate(-500 -446)">${glyph()}</g></g>
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
  const rounded = notesIconSvg('rounded')
  const square = notesIconSvg('square')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'favicon.svg'), rounded)
  for (const size of [64, 192, 512]) await png(rounded, size, join(root, 'icons', `icon-${size}.png`))
  await png(square, 512, join(root, 'icons', 'icon-maskable-512.png'))
  await png(square, 180, join(root, 'icons', 'apple-touch-icon.png'))
  await browser.close()
  console.log('Noesis Notes icons written')
}
