// Plain text, Markdown and web pages.

import { escapeXml, mergeTiny, plainText, splitChapters, tidyHtml } from './html'
import type { Draft } from './types'

const nameToTitle = (name: string) =>
  name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Untitled'

// Reads bytes as text: UTF-8 when valid, otherwise Windows-1252, which is what older files use.
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

const HEADING = /^(chapter|part|book|section|prologue|epilogue|preface|introduction|foreword|appendix)\b.{0,70}$/i
const NUMERAL = /^(?:[IVXLC]{1,7}|\d{1,3})\.?$/

export function textToDraft(raw: string, filename: string): Draft {
  let text = raw.replace(/\r\n?/g, '\n')
  // Project Gutenberg wraps books in licence text; keep the book itself.
  const start = text.match(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/i)
  const end = text.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG/i)
  if (start && start.index !== undefined && end > start.index) text = text.slice(start.index + start[0].length, end)
  const head = raw.slice(0, 4000)
  if (!start) text = text.replace(/^((?:Title|Author):[^\n]*\n+)+/i, '')
  const title = head.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || nameToTitle(filename)
  const author = head.match(/^Author:\s*(.+)$/im)?.[1]?.trim() || 'Unknown author'

  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
  const chapters: Array<{ title: string; html: string }> = []
  let current: { title: string; html: string } | null = null
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim())
    const single = lines.length === 1 ? lines[0] : ''
    if (single && (HEADING.test(single) || (NUMERAL.test(single) && single.length < 8))) {
      current = { title: single, html: `<h2>${escapeXml(single)}</h2>` }
      chapters.push(current)
      continue
    }
    const short = lines.length > 1 && lines.every((line) => line.length < 60)
    const body = short ? lines.map(escapeXml).join('<br/>') : escapeXml(lines.join(' '))
    if (!current) {
      current = { title, html: '' }
      chapters.push(current)
    }
    current.html += `<p>${body}</p>`
  }
  if (chapters.length < 2) return { title, author, chapters: chunk(chapters[0]?.html ?? '', title), pictures: [] }
  return { title, author, chapters: mergeTiny(chapters, 300), pictures: [] }
}

// One long block of text is cut into parts so each page loads quickly.
function chunk(html: string, title: string): Array<{ title: string; html: string }> {
  if (html.length < 60_000) return [{ title, html }]
  const paragraphs = html.split('</p>').filter(Boolean)
  const parts: Array<{ title: string; html: string }> = []
  let buffer = ''
  for (const paragraph of paragraphs) {
    buffer += `${paragraph}</p>`
    if (buffer.length > 30_000) {
      parts.push({ title: `Part ${parts.length + 1}`, html: buffer })
      buffer = ''
    }
  }
  if (buffer) parts.push({ title: `Part ${parts.length + 1}`, html: buffer })
  return parts
}

function inline(text: string): string {
  return escapeXml(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '$1')
}

export function markdownToHtml(source: string): string {
  const out: string[] = []
  let paragraph: string[] = []
  let list: 'ul' | 'ol' | null = null
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const endList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  let fence = false
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^```/.test(line)) {
      flush()
      endList()
      fence = !fence
      continue
    }
    if (fence) {
      out.push(`<pre>${escapeXml(line)}</pre>`)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    const bullet = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (heading) {
      flush()
      endList()
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
    } else if (bullet) {
      flush()
      const kind = /\d/.test(bullet[1]) ? 'ol' : 'ul'
      if (list !== kind) {
        endList()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline(bullet[2])}</li>`)
    } else if (/^>\s?/.test(line)) {
      flush()
      endList()
      out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`)
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flush()
      endList()
      out.push('<hr/>')
    } else if (!line.trim()) {
      flush()
      endList()
    } else {
      endList()
      paragraph.push(line.trim())
    }
  }
  flush()
  endList()
  return out.join('')
}

export function markdownToDraft(source: string, filename: string): Draft {
  const html = tidyHtml(markdownToHtml(source))
  const first = source.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const title = first || nameToTitle(filename)
  return { title, author: 'Unknown author', chapters: splitChapters(html, title), pictures: [] }
}

export function htmlToDraft(source: string, filename: string): Draft {
  const title = plainText(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || nameToTitle(filename)
  const author =
    source.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? 'Unknown author'
  const body = source.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? source
  return { title, author, chapters: mergeTiny(splitChapters(tidyHtml(body), title), 300), pictures: [] }
}
