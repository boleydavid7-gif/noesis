// Listing a WebDAV folder (Nextcloud, ownCloud and others) so books in it can be added.

import { isImportable } from './convert'

export type DavEntry = { url: string; name: string; folder: boolean; size?: number }

const unescape = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const tag = (block: string, name: string) =>
  block.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'))?.[1]

// Reads a "multistatus" answer. Folders come first, then book files; other files are left out.
export function parseMultistatus(xml: string, folderUrl: string): DavEntry[] {
  const here = new URL(folderUrl)
  const entries: DavEntry[] = []
  for (const match of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const block = match[1]
    const href = tag(block, 'href')
    if (!href) continue
    let url: URL
    try {
      url = new URL(unescape(href.trim()), here)
    } catch {
      continue
    }
    // The folder lists itself first; skip that, and anything on another host.
    if (url.host !== here.host || url.pathname.replace(/\/$/, '') === here.pathname.replace(/\/$/, '')) continue
    const folder = /<(?:[\w-]+:)?collection\b/i.test(block)
    const name = decodeURIComponent(url.pathname.replace(/\/$/, '').split('/').pop() ?? '')
    if (!name || name.startsWith('.')) continue
    if (!folder && !isImportable(name)) continue
    const size = Number(tag(block, 'getcontentlength'))
    entries.push({ url: url.toString(), name, folder, size: Number.isFinite(size) && size > 0 ? size : undefined })
  }
  return entries.sort(
    (a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  )
}
