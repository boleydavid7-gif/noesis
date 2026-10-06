# Noesis

Noesis is a reader-first learning space for books and study material. It keeps
the useful ideas from IT PATH—Second Brain capture, source-grounded AI help,
notes, progress, and learning paths—without assuming that the learner is
studying IT, cybersecurity, or automotive repair.

The product centers on four things:

- Read EPUBs and other study material in a focused reader.
- Highlight passages, write notes, and connect every note to its source.
- Ask Noema about the selected passage, chapter, book, or library.
- Group books into learning paths and track real reading and review progress.

## Development

```sh
npm install
npm run dev
```

The app imports EPUB and PDF files locally, reads EPUB title, author, cover, and
table of contents, and stores local files in IndexedDB so they can be opened
again. The reader saves its CFI and percentage as you move through a book.
Explore searches Open Library, Project Gutenberg, OpenAlex, and Internet
Archive. Downloadable files are imported locally; borrowed or hosted items open
their official reader inside Noesis with a source-page fallback. Notes persist
in the browser and sync to Supabase after email sign-in. Noesis keeps
`GEMINI_API_KEY` on the Worker.

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

## Cloudflare setup

This repository uses a static-assets Worker. Keep the build command as
`npm run build` and the deploy command as `npx wrangler deploy`. Add the
`GEMINI_API_KEY` Worker secret before asking Noema a question. Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as build variables and
enable email/password accounts in Supabase. Anonymous sign-in is optional for
local-first use; a learner can create an account from the Account page and
upgrade the current anonymous session without losing notes. Apply both
migrations in `supabase/migrations/` to enable note sync and the private
`noesis-backups` storage bucket. Cloud Backup can then upload and restore the
complete EPUB, notes, covers, and learning-path ZIP. The downloaded ZIP can
also be stored in Google Drive, Dropbox, or OneDrive; direct provider OAuth
sync requires an app registration with that provider.
