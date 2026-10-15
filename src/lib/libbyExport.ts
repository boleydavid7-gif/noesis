// Reads what Libby exports for a book (Timeline › a title › Actions › Export reading journey) as JSON ("Data") or
// CSV ("Spreadsheet"): its highlights and the notes on them. Field names are read loosely so small changes in
// Libby's file still come through. Bookmarks carry no words and are left out.
import type { Clipping } from './clippings'

type Raw = Record<string, unknown>
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim()
    : value && typeof value === 'object' && typeof (value as Raw).text === 'string'
      ? String((value as Raw).text).trim()
      : ''

function when(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return new Date(value < 1e12 ? value * 1000 : value).toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(/^\d+$/.test(value) ? Number(value) : value)
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString()
  }
  return undefined
}

const place = (percent: unknown, chapter: string) => {
  const share = typeof percent === 'number' ? percent : typeof percent === 'string' ? Number(percent) : NaN
  const at = Number.isFinite(share) ? `${Math.round(share <= 1 ? share * 100 : share)}%` : ''
  return [chapter, at].filter(Boolean).join(' · ')
}

function fromJourney(journey: Raw): Clipping[] {
  const about = (journey.readingJourney ?? journey) as Raw
  const bookTitle = text(about.title) || text(journey.title)
  const author = text(about.author) || text(journey.author)
  const list = Array.isArray(journey.highlights) ? (journey.highlights as Raw[]) : []
  if (!bookTitle) return []
  return list.flatMap((item) => {
    const quote = text(item.quote) || text(item.highlight) || text(item.text)
    const note = text(item.note)
    if (!quote && !note) return []
    const chapter = text(item.chapter)
    return [
      {
        bookTitle,
        author,
        kind: note ? 'note' : 'highlight',
        location: place(item.percent ?? item.progress, chapter),
        addedAt: when(item.timestamp ?? item.date ?? item.created),
        body: note || quote,
        quote: note ? quote || undefined : undefined,
        chapter: chapter || undefined,
        from: 'libby',
      } satisfies Clipping,
    ]
  })
}

/** Cells of a CSV (or semicolon/tab separated) file, quotes respected. */
export function csvRows(input: string): string[][] {
  const first = input.split(/\r?\n/, 1)[0] ?? ''
  const separator = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === separator) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function fromCsv(input: string): Clipping[] {
  const [head, ...rows] = csvRows(input.replace(/^﻿/, ''))
  if (!head) return []
  const names = head.map((name) => name.trim().toLowerCase())
  const col = (...options: string[]) => names.findIndex((name) => options.some((option) => name === option))
  const title = col('title', 'book', 'book title')
  const author = col('author', 'authors', 'creator')
  const quote = col('quote', 'highlight', 'text', 'passage')
  const note = col('note', 'notes', 'comment')
  const chapter = col('chapter', 'section')
  const percent = col('percent', 'progress', 'position')
  const stamp = col('timestamp', 'date', 'created', 'when')
  const activity = col('activity', 'type', 'kind')
  const details = col('details', 'detail')
  if (title < 0 || (quote < 0 && note < 0 && details < 0)) return []
  return rows.flatMap((row) => {
    const get = (index: number) => (index >= 0 ? (row[index] ?? '').trim() : '')
    const kind = get(activity).toLowerCase()
    if (kind && !/highlight|note/.test(kind)) return []
    const words = get(quote) || (/highlight/.test(kind) ? get(details) : '')
    const thought = get(note) || (/note/.test(kind) && !/highlight/.test(kind) ? get(details) : '')
    if (!get(title) || (!words && !thought)) return []
    return [
      {
        bookTitle: get(title),
        author: get(author),
        kind: thought ? 'note' : 'highlight',
        location: place(get(percent) || undefined, get(chapter)),
        addedAt: when(get(stamp)),
        body: thought || words,
        quote: thought ? words || undefined : undefined,
        chapter: get(chapter) || undefined,
        from: 'libby',
      } satisfies Clipping,
    ]
  })
}

/** Highlights from a Libby export, JSON or CSV; empty when the file is neither. */
export function parseLibbyExport(input: string): Clipping[] {
  const trimmed = input.replace(/^﻿/, '').trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed) as unknown
      const journeys = Array.isArray(data) ? data : [data]
      return journeys.flatMap((item) => (item && typeof item === 'object' ? fromJourney(item as Raw) : []))
    } catch {
      return []
    }
  }
  return fromCsv(trimmed)
}
