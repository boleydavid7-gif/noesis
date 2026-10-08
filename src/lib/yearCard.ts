// A shareable picture of the year in reading, drawn in the browser.

import { formatHours, type ReadingStats } from './stats'
import { wrapLines } from './quoteCard'

export function renderYearCard(stats: ReadingStats, accent = '#c7a36a'): Promise<Blob> {
  const size = 1080
  const margin = 110
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Your browser could not draw the picture.'))
  const gradient = ctx.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, '#0d2238')
  gradient.addColorStop(1, '#060f1b')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = accent
  ctx.font = '600 34px system-ui, sans-serif'
  ctx.fillText(`MY ${stats.year} IN READING`, margin, margin + 30)

  const rows: Array<[string, string]> = [
    [formatHours(stats.minutes), 'spent reading'],
    [`${stats.days}`, stats.days === 1 ? 'day with a book open' : 'days with a book open'],
    [`${stats.booksFinished}`, stats.booksFinished === 1 ? 'book finished' : 'books finished'],
    [`${stats.notes}`, stats.notes === 1 ? 'note saved' : 'notes saved'],
    [`${stats.longestStreak}`, 'day longest streak'],
  ]
  let y = margin + 150
  for (const [big, small] of rows) {
    ctx.fillStyle = '#f3ecdc'
    ctx.font = '700 84px Georgia, serif'
    ctx.fillText(big, margin, y)
    ctx.fillStyle = 'rgba(243, 236, 220, 0.65)'
    ctx.font = '32px system-ui, sans-serif'
    ctx.fillText(small, margin, y + 44)
    y += 150
  }
  if (stats.topBook) {
    ctx.fillStyle = accent
    ctx.font = '600 28px system-ui, sans-serif'
    const lines = wrapLines(
      (text) => ctx.measureText(text).width,
      `Most read: ${stats.topBook.title}`,
      size - margin * 2,
    )
    ctx.fillText(lines[0] ?? '', margin, size - margin + 10)
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(243, 236, 220, 0.55)'
  ctx.font = '600 26px system-ui, sans-serif'
  ctx.fillText('NOESIS', size - margin, margin + 30)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture.'))), 'image/png'),
  )
}
