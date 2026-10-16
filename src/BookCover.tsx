import type { CSSProperties } from 'react'
import type { LibraryBook } from './lib/library'

// A steady hue from the title, so a book keeps its color on every device.
function hueOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return [18, 32, 145, 160, 200, 215, 265, 340, 8, 48][hash % 10]
}

export function BookCover({ book, compact = false }: { book: LibraryBook; compact?: boolean }) {
  const image = book.coverDataUrl || book.coverUrl
  if (image)
    return (
      <div
        className={`book-cover ${compact ? 'book-cover-compact' : ''} book-cover-image`}
        aria-label={book.title}
        style={{ backgroundImage: `url("${image.replace(/"/g, '%22')}")` }}
      />
    )
  return (
    <div
      className={`book-cover book-cover-made ${compact ? 'book-cover-compact' : ''}`}
      aria-label={book.title}
      style={{ '--cover-h': hueOf(book.title || book.id) } as CSSProperties}
    >
      <span className="made-title">{book.title}</span>
      <span>
        <span className="made-rule" aria-hidden="true" />
        {book.author && !/^unknown author$/i.test(book.author) ? (
          <span className="made-author">{book.author}</span>
        ) : null}
      </span>
    </div>
  )
}
