// Turns a saved passage into a shareable picture, drawn on a canvas in the browser.

// Breaks text into lines that fit a width, using whatever measuring function the canvas gives us.
export function wrapLines(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const attempt = line ? `${line} ${word}` : word
      if (line && measure(attempt) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = attempt
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export function renderQuoteCard(quote: string, source: string, accent = '#c7a36a'): Promise<Blob> {
  const size = 1080
  const margin = 120
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Your browser could not draw the card.'))

  const gradient = ctx.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, '#0d2238')
  gradient.addColorStop(1, '#060f1b')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = accent
  ctx.font = '700 220px Georgia, serif'
  ctx.fillText('“', margin - 20, margin + 150)

  const text = quote.trim().slice(0, 700)
  let fontSize = 54
  let lines: string[] = []
  for (; fontSize >= 28; fontSize -= 2) {
    ctx.font = `${fontSize}px Georgia, serif`
    lines = wrapLines((value) => ctx.measureText(value).width, text, size - margin * 2)
    if (lines.length * fontSize * 1.4 <= size - margin * 2 - 330) break
  }
  ctx.fillStyle = '#f3ecdc'
  ctx.textBaseline = 'alphabetic'
  let y = margin + 230
  for (const line of lines) {
    ctx.fillText(line, margin, y)
    y += fontSize * 1.4
  }

  ctx.fillStyle = accent
  ctx.fillRect(margin, size - margin - 90, 64, 3)
  ctx.font = '600 34px system-ui, sans-serif'
  ctx.fillStyle = accent
  ctx.fillText(source.slice(0, 60) || 'Noesis', margin, size - margin - 40)
  ctx.font = '600 26px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(243, 236, 220, 0.55)'
  ctx.textAlign = 'right'
  ctx.fillText('NOESIS', size - margin, size - margin - 40)

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture.'))), 'image/png'),
  )
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
}
