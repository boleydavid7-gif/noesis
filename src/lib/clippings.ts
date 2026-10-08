// Reads the "My Clippings.txt" file a Kindle keeps, so highlights made there can be brought in.

export type Clipping = {
  bookTitle: string
  author: string
  kind: 'highlight' | 'note'
  location: string
  addedAt?: string
  body: string
}

const SEPARATOR = /\r?\n={5,}\r?\n?/

function splitTitle(line: string): { bookTitle: string; author: string } {
  const clean = line.replace(/^﻿/, '').trim()
  const match = clean.match(/^(.*)\(([^()]*)\)\s*$/)
  return match ? { bookTitle: match[1].trim(), author: match[2].trim() } : { bookTitle: clean, author: '' }
}

export function parseClippings(text: string): Clipping[] {
  const out: Clipping[] = []
  for (const block of text.split(SEPARATOR)) {
    const lines = block
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
    const nonEmpty = lines.filter(Boolean)
    if (nonEmpty.length < 3) continue
    const [titleLine, meta, ...rest] = nonEmpty
    const kind = /your note/i.test(meta) ? 'note' : /your highlight/i.test(meta) ? 'highlight' : null
    if (!kind) continue // bookmarks carry no text
    const body = rest.join('\n').trim()
    if (!body) continue
    const location = meta.match(/(?:location|loc\.?|page)\s+([\d-]+)/i)?.[0] ?? ''
    const added = meta.match(/added on (.+)$/i)?.[1]
    const parsed = added ? new Date(added) : null
    out.push({
      ...splitTitle(titleLine),
      kind,
      location,
      addedAt: parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : undefined,
      body,
    })
  }
  return out
}
