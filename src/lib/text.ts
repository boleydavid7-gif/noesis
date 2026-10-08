export function relevantExcerpt(text: string, question: string, limit = 30_000): string {
  if (text.length <= limit) return text
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3)
  const lower = text.toLowerCase()
  const position =
    terms
      .map((term) => lower.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, Math.min(position - Math.floor(limit * 0.22), text.length - limit))
  return `${start > 0 ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`
}

export function friendlyBookError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : ''
  if (/zip|slice|central directory|corrupt|invalid/i.test(message))
    return 'Noesis could not open this EPUB. Make sure it is a complete, DRM-free .epub file, not a preview page.'
  return message || fallback
}
