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

## Icon and design

- The icon is drawn by `scripts/icons/build.mjs` (`node scripts/icons/build.mjs`): a navy tile lit from the top, the
  open book with an olive branch in gold, on the same keylines as the Proairetos family's icons and inside the circle a
  maskable crop keeps. It writes `public/favicon.svg`, `public/noesis-mark.svg` and every PNG in `public/icons/`. After
  changing it, bump `CACHE` in `public/sw.js`.
- Inside the app the tile is never shown: `NoesisMark` draws the same shapes (`src/lib/markGlyph.ts`, kept equal to the
  generator by a test) in one colour, the lighter parts as a lighter shade. No "by Proairetos" in Noesis's own header.
- Every picture is a flat drawn scene in the Proairetos family's style, drawn by `scripts/scenes/noesis.mjs`
  (`engine.mjs` is the family's kit in a richer cut: one light at `LAMP_X` with its faint ring, no clouds or second
  sun or moon, ridges shaded from a lit crest with light along their tops, soft mist, a vignette, drawn at twice the
  size and scaled down): the default reading view (`noesis-hero.jpg`, `noesis-header.webp`,
  `noesis-sidebar.webp`: a lake at sunset from a sill with an open book) and every choosable scene in `public/scenes/`,
  at the same names and sizes. Run `node scripts/scenes/noesis.mjs [part of a file name]` (needs ffmpeg), then bump
  `CACHE` in `public/sw.js`.
- Noema's sign is the speech bubble with a question mark (`MessageCircleQuestionMark` as `NoemaIcon`), never a sparkle.
- The design block at the end of `src/App.css`: no glow under buttons or around Noema; choices and Noema's options are
  grouped rows; labels are sentence case; the serif is for page titles, book titles, quotes and highlights.

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
`VITE_ONEDRIVE_CLIENT_ID`, and `VITE_DROPBOX_APP_KEY`. Noesis never receives the
provider password or client secret. Connect the provider from Cloud Backup after
signing in. A ZIP export remains available for one-off manual transfers.

### OAuth redirect URIs

Each provider redirects back to a clean path with no query string (Microsoft
rejects query strings for apps that allow personal accounts). Register these
exact URLs in each provider, replacing the host with your live Noesis URL and
adding your local one (for example `http://localhost:5173`) as well:

| Provider     | Redirect URI                                  |
| ------------ | --------------------------------------------- |
| Google Drive | `https://YOUR-NOESIS-HOST/oauth/google-drive` |
| OneDrive     | `https://YOUR-NOESIS-HOST/oauth/onedrive`     |
| Dropbox      | `https://YOUR-NOESIS-HOST/oauth/dropbox`      |

For OneDrive, register it in Microsoft Entra under Authentication as a
"Single-page application" platform URI and enable the implicit grant for access
tokens.

### Worker protection

`/api/tutor`, `/api/search`, and `/api/resource` are rate limited per client
(best effort, per Worker isolate; add a Cloudflare rate-limiting rule for a hard
limit). Set `TUTOR_REQUIRE_AUTH=true` as a Worker variable to require a valid
Supabase session before Noema calls Gemini. `/api/models` returns 404 unless
`ADMIN_TOKEN` is set and sent as `x-admin-token`. `/api/resource` follows
redirects only to allowlisted hosts and refuses files over 80 MB.

### Passkeys and review reminders

Both need the migration `supabase/migrations/20261013000000_passkeys_and_review_push.sql` (run it in the Supabase
SQL editor) and the Worker secret `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API keys → the
service role / secret key). The Worker uses it only for the passkey and reminder tables and for making a one-time
sign-in; it is never sent to the app.

- **Passkeys** (Account): sign in with Face ID, a fingerprint or the device's PIN. A passkey is offered in the email
  field's suggestions and by "Sign in with a passkey". Signed in, Account lists them with Add a passkey and Remove.
  The Worker checks the passkey's signature (`/api/passkey/begin`, `/api/passkey/finish`) and returns a one-time
  sign-in; no email is sent. Passkeys belong to the site they were made on.
- **Review reminders with Noesis closed**: generate keys once with `npx web-push generate-vapid-keys`, then add the
  Worker variable `VAPID_PUBLIC_KEY`, and the secrets `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (for example
  `mailto:you@example.com`). `wrangler.jsonc` runs the Worker every 15 minutes (`triggers.crons`); it sends one
  plain push ("Review cards are ready.") to each device whose next card has come due, at most once a day. Turn on
  Settings → Notifications → Review reminders while signed in, in the installed app.

### Device features (no setup)

- Reader: the screen stays on while a book is open (Settings → Reading → Keep the screen on); Listen shows the
  chapter and book on the lock screen with play, pause and next or previous chapter (Android and computers; on
  iPhone the built-in voice stops when the screen locks).
- Open with Noesis (computers, Chrome or Edge, installed app): EPUB, PDF, Kindle (DRM-free), Word, text, Markdown,
  web pages, FictionBook and CBZ files (`file_handlers`). Share into Noesis (Android, computers): files go through
  `POST /share` in the service worker to the ordinary import; shared words and links still become a note.
- Scanned PDFs: "Read this page's text" in the PDF toolbar reads a scanned page on the device (Tesseract; the
  worker, core and English data are copied into `dist/ocr/` by the build, about 7 MB fetched the first time).
  Keep it as a note, ask Noema about it, or copy it.
- Translate a selected passage on the device (Chrome's built-in Translator), from the reader's more menu.
- Pages cross-fade (View Transitions), unless motion is turned down. Reduce transparency and Increase contrast in
  the device's settings make panels solid and muted text stronger. Highlighting and grading a review card give a
  light tap (Android; iPhone with iOS 18 and later). Account and cloud syncs run one tab or window at a time.
