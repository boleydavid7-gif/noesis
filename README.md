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

The first slice is a responsive dashboard with a working Second Brain capture
flow and a server-side GAYL tutor endpoint. Notes persist in the browser and
sync to Supabase when the browser-safe Supabase variables and anonymous auth
are enabled. Cloudflare serves the static Vite build and keeps `GEMINI_API_KEY`
on the Worker.

EPUB parsing and the persistent reader are still the next product slices.

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
`GEMINI_API_KEY` Worker secret before asking GAYL a question. To enable cloud
note sync, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as build
variables and apply the migration in `supabase/migrations/`.
