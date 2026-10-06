# Noesis

Noesis is a reader-first learning space for books and study material. It keeps
the useful ideas from IT PATH—Second Brain capture, source-grounded AI help,
notes, progress, and learning paths—without assuming that the learner is
studying IT, cybersecurity, or automotive repair.

The product centers on four things:

- Read EPUBs and other study material in a focused reader.
- Highlight passages, write notes, and connect every note to its source.
- Ask GAYL about the selected passage, chapter, book, or library.
- Group books into learning paths and track real reading and review progress.

## Development

```sh
npm install
npm run dev
```

The first slice is a responsive dashboard prototype. It demonstrates the
library, learning paths, notes, progress, tutor context, and import entry point.
EPUB parsing, the persistent reader, Supabase storage, and AI calls will be
added in the next slices.

## Direction

The universal data model will treat a book as a source rather than turning it
into a fixed course:

`books` → `book_chapters` → `reading_progress` → `highlights` and `notes`

Learning paths will organize books around a goal. Practice and review can be
generated when useful, but the original book remains the primary reading
experience.

## Reference

The existing IT PATH repository is the reference implementation for the
Second Brain, AI runtime, authentication, and learner-state patterns. Noesis
is intentionally a separate application so its universal reading model can
develop without changing the production IT PATH app.
