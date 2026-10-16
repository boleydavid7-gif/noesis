// Links into Libby. Libby's books can only be read in Libby (or sent to a Kindle in the US), so Noesis opens it at
// the right place: the shelf, the reader's library, or a search there.
import type { LibrarySystem } from './publicLibrary'

export const LIBBY_HOME = 'https://libbyapp.com/'
export { LIBBY_SHELF } from './loans'

export const libbyLibrary = (library: LibrarySystem | null) =>
  library?.libbyKey ? `https://libbyapp.com/library/${encodeURIComponent(library.libbyKey)}` : LIBBY_HOME

export function libbySearch(library: LibrarySystem | null, query: string): string {
  const words = query.trim()
  if (!library?.libbyKey) return LIBBY_HOME
  const key = encodeURIComponent(library.libbyKey)
  return words
    ? `https://libbyapp.com/search/${key}/search/query-${encodeURIComponent(words)}/page-1`
    : `https://libbyapp.com/library/${key}`
}

// Opening Libby's app rather than its website. On Android, an intent link names the Libby app and falls back to the
// web page when it is not installed. On iPhone, a libbyapp.com link opens the app only when followed in place (not in
// a new tab), so phones follow these links in place; computers open a new tab.
const LIBBY_ANDROID = 'com.overdrive.mobile.android.libby'

export function libbyAppLink(url: string, agent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (!/Android/i.test(agent)) return url
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !/(^|\.)libbyapp\.com$/.test(parsed.hostname)) return url
    return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;package=${LIBBY_ANDROID};S.browser_fallback_url=${encodeURIComponent(url)};end`
  } catch {
    return url
  }
}

/** Link attributes for a Libby page: the app where a phone has it, a new tab on a computer. */
export function libbyLinkProps(url: string, agent = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  const phone = /Android|iPhone|iPad|iPod/i.test(agent)
  return phone ? { href: libbyAppLink(url, agent) } : { href: url, target: '_blank', rel: 'noreferrer noopener' }
}
