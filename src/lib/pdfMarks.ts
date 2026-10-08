// Where a highlight sits on a PDF page, kept as fractions of the page so it survives zooming.

export type PdfRect = { x: number; y: number; w: number; h: number }

// "pdf:3:0.1,0.2,0.3,0.02;0.1,0.23,0.2,0.02" is page 3 with two lines marked.
export function parsePdfLocation(value: string | undefined): { page: number; rects: PdfRect[] } | null {
  const match = value?.match(/^pdf:(\d+)(?::(.*))?$/)
  if (!match) return null
  const rects: PdfRect[] = []
  for (const part of (match[2] ?? '').split(';')) {
    const numbers = part.split(',').map(Number)
    if (numbers.length === 4 && numbers.every((number) => Number.isFinite(number)))
      rects.push({ x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3] })
  }
  return { page: Number(match[1]), rects }
}

export const parseRects = (value: string | undefined): PdfRect[] => parsePdfLocation(value)?.rects ?? []

// Pages whose text contains the words, with a little text around the first match.
export function findInPages(texts: string[], query: string, limit = 200): Array<{ page: number; snippet: string }> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const found: Array<{ page: number; snippet: string }> = []
  for (let index = 0; index < texts.length && found.length < limit; index += 1) {
    const text = texts[index].replace(/\s+/g, ' ')
    let at = text.toLowerCase().indexOf(needle)
    // A page with several matches lists each, up to a few.
    for (let count = 0; at >= 0 && count < 5 && found.length < limit; count += 1) {
      const from = Math.max(0, at - 40)
      found.push({
        page: index + 1,
        snippet: `${from > 0 ? '…' : ''}${text.slice(from, at + needle.length + 60)}…`,
      })
      at = text.toLowerCase().indexOf(needle, at + needle.length)
    }
  }
  return found
}
