# Noesis project context

Noesis is a separate development product; it must not change the production IT
PATH application.

## Product direction

Noesis is a subject-agnostic, reader-first learning space. A learner imports an
EPUB, reads it, captures highlights and notes, asks Noema about the current
reading context, searches permitted free resources, and groups books into
learning paths. A book stays a book; optional summaries, questions, and review
prompts can be added without forcing the source into fixed lessons.

The visual reference is the dashboard mockup: a dark, calm workspace with a
left navigation rail, a resume-reading card, a library of cover cards with
progress, learning-path collections, recent notes, a Noema tutor popup, and
useful progress metrics.

## Reusable IT PATH reference

Port concepts selectively from `/workspace/itpath-builder`:

- `src/components/layout/side-panel.tsx`: Second Brain popup and text-to-note flow.
- `src/lib/knowledge.functions.ts`: authenticated knowledge storage and source-grounded search.
- `src/lib/ai/run.server.ts` and `src/lib/ai/gemini-runtime.server.ts`: Gemini runtime and guarded AI calls.
- Supabase client and auth boundaries.

Do not copy the IT-specific curriculum, certifications, automotive content,
domain registry, or fixed lesson engines into the universal core.

## Current repository status

The current app is a working reader-first build:

- EPUB import extracts title, author, cover, and table of contents.
- EPUB binaries live in IndexedDB; metadata, CFI, and progress live in local
  storage, so the reader resumes on the same browser.
- Read, Notes, Learning Paths, Progress, Explore, and Cloud Backup are real
  pages. Learning paths can contain books and show aggregate progress.
- Second Brain captures typed notes and selected text from any page.
- Noema is a global tutor popup backed by the Cloudflare Worker `/api/tutor`.
- Account supports email/password sign-in and can upgrade an anonymous session
  without moving its notes to a new user.
- Explore searches Project Gutenberg, Open Library, OpenAlex, and Internet Archive through `/api/search`; hosted and borrowed items can open their official reader inside Noesis.
- The right sidebar (every page except Settings) holds Today's focus (timer, add/remove
  steps), a calendar for classes, assignments and exams (repeating events,
  per-day check-off, synced with the account), a real weather forecast (city search or
  Detect, via Open-Meteo) and quick actions.
- Learning paths are subjects: a map of questions around the reader's books, not a course (`src/Subjects.tsx`,
  `lib/subjects.ts`, kept on the path record as `subject`, so it syncs and backs up with paths). "What are you
  curious about?" (`/api/clarify` for broad subjects, then `/api/subject`) gives four to seven areas, each with a few
  questions and a hook line; the first question of the first three areas starts in Now (at most three at a time), the
  rest wait in Later. A subject page leads with Reading (the reader's own books on it, Continue), then From before
  (an answer from two weeks or more ago, with its follow-up), Now, and Areas (not started / exploring / summed up;
  Later and Answered folded inside; add, rename, remove with undo). A question page: hook, an optional guess,
  Noema's short answer (folded), Explore grouped Books, Read, Watch, Listen, Try it (one or two each, with time and
  a "why" line, Save), In your own words (with the sources used), and What this raised (new questions go to Later).
  After five answers an area offers "Sum up this area" (`/api/sumup` drafts from the reader's own answers only;
  they edit it). Saved lists what was saved, by kind. `/api/question` names picks and the Worker keeps only what it
  can confirm: links checked, Wikipedia by exact title, YouTube through oEmbed (or found by search with the
  optional secret `YOUTUBE_API_KEY`, with lengths), podcast episodes through Apple's open podcast search; books are
  matched through `/api/book`. Older planned paths turn into subjects when opened (stages become areas, topics
  questions, ticked ones answered); the old planner, its Home shelf and the `/api/path`, `/api/materials` and
  `/api/quiz` routes are gone. Where the subject area is at least 720px wide (a container query), the map is two
  columns (Reading and Now beside Areas) and an open question has the subject's questions listed beside it. Home's
  "Your questions" shows books suggested for the questions in Now (Start, Carry on, or Find a copy) and the questions
  themselves, each opening straight to its page. While reading a book that belongs to a subject, the study panel
  lists the questions to keep in mind (ones that suggested this book first, then Now), each with Write about this.
- Your public library (Settings > Reading, or "Check your library" on a book; `PublicLibrary.tsx`,
  `lib/publicLibrary.ts`, synced preference `noesis:public-library:v1`): `/api/libraries` finds library systems with
  a branch within about 50 miles of a typed city or ZIP code, or of the reader's location (turned into a postal code
  by BigDataCloud, not kept), through Libby's locate service. `/api/library-has` says whether a book is in Libby
  (e-book, audiobook; available or the wait, OverDrive's public catalog) and, where the library's catalog is on
  BiblioCommons, whether a printed copy is in. Only what the library has is shown; every book also links to
  WorldCat, which lists libraries holding it near any place. These services have no published API terms for this
  use; each lookup fails quietly to the WorldCat link.
- Settings is one page with Account, Reading, Appearance, Library, Backup & Sync,
  AI Companion, Notifications, Privacy, and About. Every setting is stored
  locally (`noesis:settings:v1`) and read by the app: reader text/page/font,
  accent and scenery, library sort and indexing, auto-sync, Noema context and
  answer length, and review reminders.
- Cloud Backup (Settings → Backup & Sync) can connect a learner's own Google Drive, OneDrive, or Dropbox.
  It syncs a manifest and separate EPUB files, then merges them on another
  device. ZIP remains an optional manual export only.
- Settings › Backup and sync is one page: status with Sync now; Your storage (one row per provider, Connect /
  Connect again / Disconnect); Library folder (`LibraryFolderPicker`, `lib/libraryFolder.ts`, `lib/cloudFind.ts`):
  a folder in the person's storage, looked through on opening and on coming back into view, each file once (by name
  and size, a second path is the same book), files already in the library linked, newer files replacing older ones,
  removed books not brought back, under the Web Lock `noesis-library-folder`; the folder and the path map are synced
  preferences. Options: automatic sync, ZIP export and restore, Clear the library (then the folder is read again).
  Connections now ask for `Files.Read` (OneDrive) and `drive.readonly` (Google) beside the Noesis folder
  (`readsFolders`); older ones show Connect again. A book not on this device is fetched from the account, the Noesis
  folder, then anywhere in a connected storage by its file name and size (`foundIn` remembers where). Google's
  consent screen needs `drive.readonly` added; Dropbox's app-folder app sees only its own folder.

## Installed foundation

Noesis uses React and Vite with Supabase, epubjs, jszip, and Wrangler. Install
with `npm install` or `bun install`. Never commit `.env` or secret values.

## Next build order

Done recently: whole-book search with jump-to-result, BM25 passage retrieval
for Noema (answers cite `(Section N)`), deletion tombstones in both sync
manifests, and review prompts with a spaced-repetition queue.

1. Include the calendar, focus steps and review cards in the ZIP backup. They
   already sync through the account and cloud providers.
2. Map book sections to table-of-contents labels so retrieval citations can say
   "Chapter 3" instead of "Section 3", and add stable source locations.
3. Merge learning-path edits by timestamp (paths currently merge by creation
   time only) and add richer conflict history to cloud sync.
4. Add appearance controls and richer annotations.
5. Add source-grounded practice and subject-specific activity adapters.

## Boundaries

Only import material the learner is permitted to use. DRM-protected EPUBs
cannot be processed. Public links can be inaccessible, paywalled, or dynamic.
AI output must remain grounded in imported text and should be reviewable before
it is treated as a learning record.

The app's words use American English (color, center, catalog, canceled, recognize, behavior);
cited titles stay as published.

## Verification

The current source passes `npm run typecheck`, `npm run build`, `npm run lint`,
and a Wrangler dry run. The live health endpoint is
`/api/health`; free-resource search is `/api/search?q=...`.
