// Reading a rabbit hole's sources inside Noesis: a page is fetched through the Worker and read with Readability, then
// kept as plain blocks of text (never the page's own markup); a video or an episode plays in its maker's own player.
import type { Pick } from './subjects'
import { youtubeId } from './subjects'

export type Block = { kind: 'h' | 'p' | 'quote' | 'li' | 'pre'; text: string }
export type ReadPage = {
  url: string
  title: string
  byline?: string
  site?: string
  blocks: Block[]
  minutes: number
}
export type Player = { kind: 'video' | 'audio-frame' | 'audio'; src: string; ratio?: string }
export type SourceView = 'page' | 'player'

// Where a pick can open inside Noesis: a player for videos and episodes, the reader for pages, else nowhere.
export function sourceView(pick: Pick): SourceView | null {
  if (!pick.url || pick.type === 'book') return null
  if (playerFor(pick.url)) return 'player'
  if (pick.type === 'watch' || pick.type === 'listen') return null
  if (/\.(pdf|epub|zip|mp4|mov)(\?|#|$)/i.test(pick.url)) return null
  return 'page'
}

export function playerFor(url: string): Player | null {
  const video = youtubeId(url)
  if (video && /^[\w-]{6,20}$/.test(video))
    return {
      kind: 'video',
      src: `https://www.youtube-nocookie.com/embed/${video}?rel=0&playsinline=1`,
      ratio: '16 / 9',
    }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.replace(/^www\./, '')
  const vimeo = host === 'vimeo.com' ? parsed.pathname.match(/^\/(\d{5,12})\/?$/)?.[1] : null
  if (vimeo) return { kind: 'video', src: `https://player.vimeo.com/video/${vimeo}?dnt=1`, ratio: '16 / 9' }
  if (host === 'open.spotify.com') {
    const match = parsed.pathname.match(/^\/(episode|show)\/([A-Za-z0-9]{10,30})/)
    if (match) return { kind: 'audio-frame', src: `https://open.spotify.com/embed/${match[1]}/${match[2]}` }
  }
  if (host === 'podcasts.apple.com' && /\/podcast\//.test(parsed.pathname))
    return { kind: 'audio-frame', src: `https://embed.podcasts.apple.com${parsed.pathname}${parsed.search}` }
  if (/\.(mp3|m4a|ogg|opus|aac)$/i.test(parsed.pathname)) return { kind: 'audio', src: parsed.toString() }
  return null
}

const BLOCKS: Record<string, Block['kind']> = {
  H1: 'h',
  H2: 'h',
  H3: 'h',
  H4: 'h',
  P: 'p',
  BLOCKQUOTE: 'quote',
  LI: 'li',
  PRE: 'pre',
}
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

// The readable part of a page as blocks of text: headings, paragraphs, quotes, list items and code, in order.
export function blocksFrom(root: Element): Block[] {
  const blocks: Block[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const kind = BLOCKS[child.tagName]
      if (kind) {
        // A list item or quote holding paragraphs keeps them apart.
        if ((kind === 'li' || kind === 'quote') && child.querySelector('p, li')) {
          walk(child)
          continue
        }
        const text = kind === 'pre' ? (child.textContent ?? '').trim() : squash(child.textContent ?? '')
        if (text) blocks.push({ kind, text: text.slice(0, 6_000) })
      } else if (!/^(SCRIPT|STYLE|NOSCRIPT|FIGURE|IMG|SVG|BUTTON|FORM|NAV|ASIDE)$/.test(child.tagName)) {
        // A div holding only words is a paragraph.
        if (child.children.length === 0) {
          const text = squash(child.textContent ?? '')
          if (text.length > 1) blocks.push({ kind: 'p', text: text.slice(0, 6_000) })
        } else walk(child)
      }
    }
  }
  walk(root)
  // A heading repeated as the first block is the title again.
  return blocks.filter((block, index) => !(index > 0 && block.kind === 'h' && block.text === blocks[index - 1]?.text))
}

export const readingMinutes = (blocks: Block[]) =>
  Math.max(1, Math.round(blocks.reduce((sum, block) => sum + block.text.split(' ').length, 0) / 230))

// "Dream - Wikipedia" is "Dream": a site's name after a dash or bar is taken off a page's title.
export function withoutSite(title: string, site: string): string {
  const word =
    site
      .split('.')
      .find((part) => part.length > 3 && part !== 'www')
      ?.toLowerCase() ?? site.toLowerCase()
  const match = title.match(/^(.{3,}?)\s+[|\-–—·]\s+([^|\-–—·]{2,60})$/)
  return match && match[2].toLowerCase().includes(word) ? match[1] : title
}

export class PageError extends Error {}

// A page's words, ready for the source reader.
export async function readPage(url: string, fetcher: typeof fetch = fetch): Promise<ReadPage> {
  const response = await fetcher(`/api/article?url=${encodeURIComponent(url)}`)
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    url?: string
    html?: string
    error?: string
  }
  if (!response.ok || !data.ok || typeof data.html !== 'string')
    throw new PageError(data.error || 'This page can’t be opened here.')
  const doc = new DOMParser().parseFromString(data.html, 'text/html')
  const base = doc.createElement('base')
  base.href = data.url ?? url
  doc.head.prepend(base)
  const { Readability } = await import('@mozilla/readability')
  const parsed = new Readability(doc, { charThreshold: 300 }).parse()
  if (!parsed?.content) throw new PageError('Nothing to read on this page.')
  const holder = new DOMParser().parseFromString(parsed.content, 'text/html').body
  const blocks = blocksFrom(holder)
  if (blocks.length < 2) throw new PageError('Nothing to read on this page.')
  const site = parsed.siteName ? squash(parsed.siteName) : new URL(data.url ?? url).hostname.replace(/^www\./, '')
  return {
    url: data.url ?? url,
    title: withoutSite(squash(parsed.title || doc.title || ''), site),
    byline: parsed.byline ? squash(parsed.byline) : undefined,
    site,
    blocks,
    minutes: readingMinutes(blocks),
  }
}
