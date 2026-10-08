// FictionBook, Word, OpenDocument and Rich Text files.

import JSZip from 'jszip'
import { decodeEntities, escapeXml, mergeTiny, plainText, splitChapters, tidyHtml } from './html'
import { pictureName } from './build'
import type { Draft, Picture } from './types'

const unxml = (text: string) => decodeEntities(text.replace(/<[^>]+>/g, ''))

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// ---- FictionBook (.fb2) ----

export function fb2ToDraft(xml: string, filename: string): Draft {
  const info = xml.match(/<title-info>([\s\S]*?)<\/title-info>/)?.[1] ?? ''
  const title =
    unxml(info.match(/<book-title>([\s\S]*?)<\/book-title>/)?.[1] ?? '').trim() || filename.replace(/\.[^.]+$/, '')
  const authorBlock = info.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? ''
  const part = (name: string) =>
    unxml(authorBlock.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '').trim()
  const author =
    [part('first-name'), part('middle-name'), part('last-name')].filter(Boolean).join(' ') ||
    part('nickname') ||
    'Unknown author'

  const pictures: Picture[] = []
  const names = new Map<string, string>()
  for (const match of xml.matchAll(/<binary\b([^>]*)>([\s\S]*?)<\/binary>/g)) {
    const id = match[1].match(/id="([^"]+)"/)?.[1]
    const type = match[1].match(/content-type="([^"]+)"/)?.[1] ?? 'image/jpeg'
    if (!id || !/^image\//.test(type)) continue
    const name = pictureName(pictures.length + 1, type)
    try {
      pictures.push({ name, type, data: base64ToBytes(match[2]) })
      names.set(id, name)
    } catch {
      // A damaged picture is skipped.
    }
  }
  const coverId = info.match(/<coverpage>[\s\S]*?href="#([^"]+)"/)?.[1]

  const bodies = [...xml.matchAll(/<body\b([^>]*)>([\s\S]*?)<\/body>/g)].filter((body) => !/name="notes"/.test(body[1]))
  const content = bodies.map((body) => body[2]).join('')
  const convert = (markup: string) =>
    markup
      .replace(/<title>/g, '<h2>')
      .replace(/<\/title>/g, '</h2>')
      .replace(/<subtitle>/g, '<h3>')
      .replace(/<\/subtitle>/g, '</h3>')
      .replace(/<empty-line\s*\/>/g, '<br/>')
      .replace(/<(epigraph|cite|poem|stanza)\b[^>]*>/g, '<blockquote>')
      .replace(/<\/(epigraph|cite|poem|stanza)>/g, '</blockquote>')
      .replace(/<v>/g, '<p>')
      .replace(/<\/v>/g, '</p>')
      .replace(/<emphasis>/g, '<em>')
      .replace(/<\/emphasis>/g, '</em>')
      .replace(/<image\b[^>]*href="#([^"]+)"[^>]*\/?>/g, (_, id: string) =>
        names.has(id) ? `<img src="images/${names.get(id)}" alt=""/>` : '',
      )

  // Each top-level section is a chapter.
  const sections: string[] = []
  let depth = 0
  let begin = 0
  for (const match of content.matchAll(/<section\b[^>]*>|<\/section>/g)) {
    if (match[0] === '</section>') {
      depth -= 1
      if (depth === 0) sections.push(content.slice(begin, match.index))
    } else {
      if (depth === 0) begin = (match.index ?? 0) + match[0].length
      depth += 1
    }
  }
  const sources = sections.length ? sections : [content]
  const chapters = sources.map((section, index) => {
    const html = tidyHtml(convert(section), { images: true })
    const heading = html.match(/<h2>([\s\S]*?)<\/h2>/)?.[1]
    return { title: (heading && plainText(heading)) || `Section ${index + 1}`, html }
  })
  return {
    title,
    author,
    chapters: mergeTiny(chapters, 300),
    pictures,
    cover: coverId ? names.get(coverId) : undefined,
  }
}

// ---- Word (.docx) ----

export async function docxToDraft(data: ArrayBuffer, filename: string): Promise<Draft> {
  const zip = await JSZip.loadAsync(data)
  const document = await zip.file('word/document.xml')?.async('string')
  if (!document) throw new Error('This does not look like a Word document.')
  const core = (await zip.file('docProps/core.xml')?.async('string')) ?? ''
  const html: string[] = []
  for (const match of document.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0]
    const style = paragraph.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? ''
    const heading = style.match(/^heading\s*([1-6])$/i)?.[1] ?? (/^title$/i.test(style) ? '1' : '')
    let line = ''
    for (const run of paragraph.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const markup = run[0]
      const bold = /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(markup)
      const italic = /<w:i\/>|<w:i w:val="(?:1|true)"\/>/.test(markup)
      let text = ''
      for (const piece of markup.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
        text += piece[0] === '<w:tab/>' ? ' ' : piece[0] === '<w:br/>' ? '\n' : piece[1]
      }
      if (!text) continue
      const safe = text
        .split('\n')
        .map((part) => escapeXml(decodeEntities(part)))
        .join('<br/>')
      line += bold && !heading ? `<strong>${safe}</strong>` : italic ? `<em>${safe}</em>` : safe
    }
    if (!plainText(line)) continue
    if (heading) html.push(`<h${heading}>${line}</h${heading}>`)
    else html.push(`<p>${/<w:numPr>/.test(paragraph) ? '• ' : ''}${line}</p>`)
  }
  const title =
    unxml(core.match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1] ?? '').trim() || filename.replace(/\.[^.]+$/, '')
  const author = unxml(core.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/)?.[1] ?? '').trim() || 'Unknown author'
  return { title, author, chapters: mergeTiny(splitChapters(tidyHtml(html.join('')), title), 300), pictures: [] }
}

// ---- OpenDocument text (.odt) ----

export async function odtToDraft(data: ArrayBuffer, filename: string): Promise<Draft> {
  const zip = await JSZip.loadAsync(data)
  const content = await zip.file('content.xml')?.async('string')
  if (!content) throw new Error('This does not look like an OpenDocument file.')
  const meta = (await zip.file('meta.xml')?.async('string')) ?? ''
  const html: string[] = []
  for (const match of content.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g)) {
    const inner = match[3]
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<text:s\b[^>]*\/>/g, ' ')
      .replace(/<text:tab\/>/g, ' ')
    const text = unxml(inner)
    if (!text.trim()) continue
    const safe = text
      .split('\n')
      .map((part) => escapeXml(part))
      .join('<br/>')
    const level = match[2].match(/text:outline-level="(\d)"/)?.[1]
    html.push(match[1] === 'h' ? `<h${level ?? 2}>${safe}</h${level ?? 2}>` : `<p>${safe}</p>`)
  }
  const title =
    unxml(meta.match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1] ?? '').trim() || filename.replace(/\.[^.]+$/, '')
  const author = unxml(meta.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/)?.[1] ?? '').trim() || 'Unknown author'
  return { title, author, chapters: mergeTiny(splitChapters(tidyHtml(html.join('')), title), 300), pictures: [] }
}

// ---- Rich Text (.rtf) ----

const SKIPPED = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'header',
  'footer',
  'object',
  'fldinst',
  'themedata',
  'listtable',
  'listoverridetable',
])
const SYMBOLS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  tab: '\t',
}

export function rtfToText(rtf: string): string {
  const decoder = new TextDecoder('windows-1252')
  const groups: Array<{ skip: boolean }> = [{ skip: false }]
  let out = ''
  let index = 0
  let unicodeSkip = 0
  while (index < rtf.length) {
    const char = rtf[index]
    const group = groups[groups.length - 1]
    if (char === '{') {
      groups.push({ skip: group.skip || rtf.startsWith('\\*', index + 1) })
      index += 1
    } else if (char === '}') {
      if (groups.length > 1) groups.pop()
      index += 1
    } else if (char === '\\') {
      const next = rtf[index + 1]
      if (next === '\\' || next === '{' || next === '}') {
        if (!group.skip && unicodeSkip === 0) out += next
        else if (unicodeSkip > 0) unicodeSkip -= 1
        index += 2
      } else if (next === "'") {
        const code = parseInt(rtf.slice(index + 2, index + 4), 16)
        if (unicodeSkip > 0) unicodeSkip -= 1
        else if (!group.skip && !Number.isNaN(code)) out += decoder.decode(new Uint8Array([code]))
        index += 4
      } else {
        const word = rtf.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/)
        if (!word) {
          index += 2
          continue
        }
        index += 1 + word[0].length
        const name = word[1]
        if (index - word[0].length - 1 >= 0 && rtf[index - word[0].length - 2] === '{' && SKIPPED.has(name))
          group.skip = true
        if (group.skip) continue
        if (name === 'par' || name === 'line' || name === 'sect' || name === 'page') out += '\n'
        else if (name === 'u' && word[2]) {
          const value = parseInt(word[2], 10)
          out += String.fromCodePoint(value < 0 ? value + 65536 : value)
          unicodeSkip = 1
        } else if (SYMBOLS[name]) out += SYMBOLS[name]
      }
    } else {
      if (char !== '\n' && char !== '\r' && !group.skip) {
        if (unicodeSkip > 0) unicodeSkip -= 1
        else out += char
      }
      index += 1
    }
  }
  return out
}

export function rtfToDraft(rtf: string, filename: string): Draft {
  const paragraphs = rtfToText(rtf)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  const html = paragraphs.map((line) => `<p>${escapeXml(line)}</p>`).join('')
  return { title, author: 'Unknown author', chapters: [{ title, html }], pictures: [] }
}
