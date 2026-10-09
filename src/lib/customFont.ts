// A font the reader brings themselves. It is kept on this device and used inside books.

import { loadEpubFile, saveEpubFile } from './library'

const KEY = 'noesis:font:v1'
const FILE = 'font:custom'
export const CUSTOM_FONT_FAMILY = 'NoesisCustom'
const TYPES: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

export const isFontFile = (name: string) => /\.(ttf|otf|woff2?)$/i.test(name)

export function customFontName(): string {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? 'null') as { name?: string } | null)?.name ?? ''
  } catch {
    return ''
  }
}

export async function saveCustomFont(file: File): Promise<string> {
  if (!isFontFile(file.name)) throw new Error('Choose a .ttf, .otf, .woff or .woff2 font file.')
  if (file.size > 6_000_000) throw new Error('That font file is too large. Try one under 6 MB.')
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'ttf'
  await saveEpubFile(FILE, await file.arrayBuffer())
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  localStorage.setItem(KEY, JSON.stringify({ name, type: TYPES[extension] ?? 'font/ttf' }))
  return name
}

export function clearCustomFont(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

// The style rule that makes the font available inside a book page.
export async function customFontCss(): Promise<string | null> {
  try {
    const meta = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { type?: string } | null
    if (!meta) return null
    // On a device that does not have the file yet, it comes from the account or a connected cloud.
    const data = (await loadEpubFile(FILE)) ?? (await (await import('./assetFiles')).fetchFont())
    if (!data) return null
    return `@font-face{font-family:'${CUSTOM_FONT_FAMILY}';src:url(data:${meta.type ?? 'font/ttf'};base64,${toBase64(data)});font-display:swap}`
  } catch {
    return null
  }
}
