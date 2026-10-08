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
- Turn notes into review questions you approve, then study them on a schedule.

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
in the browser and sync to Supabase after email sign-in. Cloud Backup can
connect a signed-in learner's own Google Drive, OneDrive, or Dropbox through
OAuth. Noesis stores a manifest plus separate EPUB files in that provider and
merges changes when the learner signs in on another device. A ZIP is available
only as an optional manual export; it is not the live cloud format. Noesis
keeps `GEMINI_API_KEY` on the Worker.

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
local-first use; a learner can create an account from the Account page. Apply
the knowledge migration in `supabase/migrations/` to enable note sync.

For personal cloud sync, add these public build variables in Cloudflare when
you configure the corresponding OAuth apps: `VITE_GOOGLE_DRIVE_CLIENT_ID`,
`VITE_ONEDRIVE_CLIENT_ID`, and `VITE_DROPBOX_APP_KEY`. Register the live Noesis
URL and your local development URL as redirect URLs in each provider. The
provider connection uses a browser access token and the learner's own account;
Noesis never receives the provider password or client secret. Connect the
provider from Cloud Backup after signing in. A ZIP export remains available
for one-off manual transfers.

### Worker protection

`/api/tutor`, `/api/search`, and `/api/resource` are rate limited per client
(best effort, per Worker isolate; add a Cloudflare rate-limiting rule for a hard
limit). Set `TUTOR_REQUIRE_AUTH=true` as a Worker variable to require a valid
Supabase session before Noema calls Gemini. `/api/models` returns 404 unless
`ADMIN_TOKEN` is set and sent as `x-admin-token`. `/api/resource` follows
redirects only to allowlisted hosts and refuses files over 80 MB.
