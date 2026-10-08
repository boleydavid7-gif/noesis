// Reading an OPDS catalogue: the standard way book servers (Calibre-Web, Kavita, Standard Ebooks,
// Project Gutenberg and others) list their books. Plain string work, so it runs anywhere.

export type OpdsLink = { href: string; rel: string; type: string; title: string }
export type OpdsEntry = {
  id: string
  title: string
  author: string
  summary: string
  cover?: string
  open?: string // a folder of more entries
  files: Array<{ href: string; type: string; label: string }> // EPUB or PDF downloads
}
export type OpdsFeed = {
  title: string
  entries: OpdsEntry[]
  next?: string
  search?: string
  searchDescription?: string
}

const unescape = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')

const tag = (block: string, name: string) =>
  unescape(
    block
      .match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, '')
      .trim() ?? '',
  )

const plain = (html: string) =>
  unescape(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

function links(block: string, base: string): OpdsLink[] {
  return [...block.matchAll(/<link\s+([^>]*?)\/?>/g)].flatMap((match) => {
    const attribute = (name: string) => match[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
    const href = unescape(attribute('href'))
    if (!href) return []
    try {
      return [
        {
          href: new URL(href, base).toString(),
          rel: attribute('rel'),
          type: attribute('type'),
          title: unescape(attribute('title')),
        },
      ]
    } catch {
      return []
    }
  })
}

export function parseOpds(xml: string, base: string): OpdsFeed {
  const head = xml.split(/<entry[\s>]/)[0] ?? ''
  const feedLinks = links(head, base)
  const seen = new Set<string>()
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].flatMap((match): OpdsEntry[] => {
    const block = match[1]
    const title = plain(tag(block, 'title'))
    if (!title) return []
    const entryLinks = links(block, base)
    const files = entryLinks
      .filter((link) => link.rel.includes('acquisition') && /epub|pdf/i.test(link.type) && !/kepub/i.test(link.type))
      .map((link) => ({
        href: link.href,
        type: link.type,
        label: link.title || (/pdf/i.test(link.type) ? 'PDF' : 'EPUB'),
      }))
      // EPUBs before PDFs.
      .sort((a, b) => Number(/epub/i.test(b.type)) - Number(/epub/i.test(a.type)))
    const folder = entryLinks.find(
      (link) => !link.rel.includes('acquisition') && /opds|atom/i.test(link.type) && !link.rel.includes('self'),
    )
    const cover =
      entryLinks.find((link) => /image\/thumbnail/.test(link.rel)) ??
      entryLinks.find((link) => /\/image/.test(link.rel))
    const key = `${title}|${files[0]?.href ?? folder?.href ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        id: tag(block, 'id') || title,
        title,
        author: plain(tag(block.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? '', 'name')),
        summary: plain(tag(block, 'summary') || tag(block, 'content')).slice(0, 400),
        cover: cover?.href,
        open: files.length === 0 ? folder?.href : undefined,
        files,
      },
    ]
  })
  const template = feedLinks.find((link) => link.rel === 'search' && /atom|opds/i.test(link.type))?.href
  return {
    title: plain(tag(head, 'title')),
    entries,
    next: feedLinks.find((link) => link.rel === 'next')?.href,
    search: template && /\{searchTerms\}|%7BsearchTerms%7D/.test(template) ? template : undefined,
    searchDescription: feedLinks.find((link) => /opensearchdescription/i.test(link.type))?.href,
  }
}

// An OpenSearch description names the address to use for searching.
export function searchTemplateFrom(description: string): string | undefined {
  for (const match of description.matchAll(/<Url\s+([^>]*?)\/?>/gi)) {
    const attributes = match[1]
    if (!/type="application\/atom\+xml/i.test(attributes)) continue
    const template = attributes.match(/template="([^"]+)"/i)?.[1]
    if (template) return unescape(template).replace(/\{searchTerms\??\}/g, '{searchTerms}')
  }
  return undefined
}

export const searchAddress = (template: string, query: string) =>
  template.replace(/\{searchTerms\}|%7BsearchTerms%7D/g, encodeURIComponent(query))

// Standard Ebooks asks for a sign-in before listing its whole catalogue, so it is searched from the
// Explore results instead.
export const OPDS_PRESETS = [{ name: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks.opds/' }]
