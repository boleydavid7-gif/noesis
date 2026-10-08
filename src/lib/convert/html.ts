// Turns loose HTML (from web pages, Kindle files, Word documents) into clean, well-formed XHTML.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  laquo: '«',
  raquo: '»',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      try {
        return String.fromCodePoint(value)
      } catch {
        return ''
      }
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

export const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (text: string) => escapeXml(text).replace(/"/g, '&quot;')

export const plainText = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const ALLOWED = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'i', 'em', 'strong', 'u', 's', 'blockquote', 'br', 'hr',
  'img', 'ul', 'ol', 'li', 'a', 'sup', 'sub', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'small', 'center',
]) // prettier-ignore
const VOID = new Set(['br', 'hr', 'img'])
const INLINE = new Set(['b', 'i', 'em', 'strong', 'u', 's', 'span', 'a', 'sup', 'sub', 'small', 'code'])
const BLOCK = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'pre',
  'hr',
])
const DROP_WITH_CONTENT = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'svg', 'noscript', 'form'])
const RENAME: Record<string, string> = { center: 'div' }

export function tidyHtml(input: string, options: { images?: boolean } = {}): string {
  const out: string[] = []
  const stack: string[] = []
  let skipping: string | null = null
  const closeTo = (name: string) => {
    while (stack.length) {
      const top = stack.pop() as string
      out.push(`</${top}>`)
      if (top === name) break
    }
  }
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:.-]*)([^>]*)>|([^<]+)|</g
  for (const match of input.matchAll(pattern)) {
    const [, closing, rawName, attributes = '', text] = match
    if (text !== undefined) {
      if (!skipping) out.push(escapeXml(decodeEntities(text)))
      continue
    }
    if (!rawName) continue
    const name = rawName.toLowerCase()
    if (skipping) {
      if (closing && name === skipping) skipping = null
      continue
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(attributes)) skipping = name
      continue
    }
    if (!ALLOWED.has(name)) continue
    const tag = RENAME[name] ?? name
    if (closing) {
      if (!VOID.has(tag) && stack.includes(tag)) closeTo(tag)
      continue
    }
    if (tag === 'img') {
      const source = attributes.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1]
      if (options.images && source && /^images\//.test(source)) {
        const alt = attributes.match(/\salt\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''
        out.push(`<img src="${escapeAttribute(source)}" alt="${escapeAttribute(decodeEntities(alt))}"/>`)
      }
      continue
    }
    if (VOID.has(tag)) {
      out.push(`<${tag}/>`)
      continue
    }
    if (BLOCK.has(tag)) {
      // A block cannot sit inside a paragraph or an open piece of inline formatting.
      while (stack.length && INLINE.has(stack[stack.length - 1])) closeTo(stack[stack.length - 1])
      if (stack[stack.length - 1] === 'p' || (tag === 'li' && stack[stack.length - 1] === 'li'))
        closeTo(stack[stack.length - 1])
    }
    if (tag === 'a') {
      const href = attributes.match(/\shref\s*=\s*["']([^"']+)["']/i)?.[1]
      stack.push('a')
      out.push(href && /^https?:/i.test(href) ? `<a href="${escapeAttribute(decodeEntities(href))}">` : '<a>')
      continue
    }
    stack.push(tag)
    out.push(`<${tag}>`)
  }
  while (stack.length) out.push(`</${stack.pop()}>`)
  return out.join('')
}

// Cuts tidy HTML into chapters at its main headings.
export function splitChapters(html: string, fallbackTitle: string): Array<{ title: string; html: string }> {
  const level = /<h1>/.test(html) ? 'h1' : /<h2>/.test(html) ? 'h2' : null
  if (!level) return [{ title: fallbackTitle, html }]
  const parts = html.split(new RegExp(`(?=<${level}>)`))
  const chapters: Array<{ title: string; html: string }> = []
  for (const part of parts) {
    if (!part.trim()) continue
    const heading = part.match(new RegExp(`<${level}>([\\s\\S]*?)</${level}>`))
    const title = heading ? plainText(heading[1]) : ''
    if (!heading) {
      // Text before the first heading becomes an opening section when it is more than a few words.
      if (plainText(part).length > 200) chapters.push({ title: fallbackTitle, html: part })
      continue
    }
    chapters.push({ title: title || `Section ${chapters.length + 1}`, html: part })
  }
  return chapters.length ? chapters : [{ title: fallbackTitle, html }]
}

// Folds very short sections into the one before them.
export function mergeTiny<T extends { html: string }>(chapters: T[], minimum = 400): T[] {
  const merged: T[] = []
  for (const chapter of chapters) {
    const last = merged[merged.length - 1]
    if (last && plainText(chapter.html).length < minimum) last.html += chapter.html
    else merged.push({ ...chapter })
  }
  return merged
}
