import type { LibraryBook } from './lib/library'

export function BookCover({ book, compact = false }: { book: LibraryBook; compact?: boolean }) {
  const image = book.coverDataUrl || book.coverUrl
  return (
    <div
      className={`book-cover ${compact ? 'book-cover-compact' : ''} ${image ? 'book-cover-image' : ''}`}
      aria-label={book.title}
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    >
      {!image ? <div className="book-cover-mark">N</div> : null}
    </div>
  )
}
