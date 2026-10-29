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
  Noesis leads early and steps back (`guidance` in `lib/subjects.ts`): with fewer than three answers it shows a
  one-line tip at first, offers "Next up" (the first Later question, area by area) whenever Now has room, and looks
  for picks as soon as a question opens; from three answers it offers Next up only when Now is empty; from twelve it
  waits to be asked (Find things). Sum up this area also returns pairs of questions that ask the same thing
  (`cleanMerges`); Combine joins them with Noema's wording, keeping picks and answers from both (`mergeQuestions`,
  undo). For practical subjects a question can carry "Use it": one small thing to do (from `/api/question`), marked
  Done or Not yet (`markUsed`).
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

- Question page look (iOS style): pill actions under the title; Explore has a row of filter chips (All, Books, Read,
  Watch, Listen with counts) over one inset grouped list per kind (leading cover or icon, hairlines after it);
  "where you found it" offers only picks that were opened or saved. Wikipedia calls send `WIKI_AGENT` as asked.
- Speed: `/api/question` takes `part`: "answer" (hook, short answer, follow-up, use it; 700 tokens, 20 s) or "picks"
  (books, read, watch, listen, try; 1,800 tokens, 25 s; Wikipedia's search runs while Noema writes). The app asks for
  both at once and saves each as it arrives; books are matched afterwards and added (`lib/subjectExplore.ts`
  `exploreInto`, never two requests for one question at once). Signed in, App prepares questions in the background
  before they are opened (Now, then Next up; one at a time, each tried once per visit; `questionsToPrepare`), through
  `editSubject`, which changes the latest saved subject. The subject map no longer asks for hook lines (2,000 tokens,
  30 s); a question's hook arrives with its answer part.
- Noesis Notes by Proairetos (`/notes/`, `notes/index.html` -> `src/notes/`; its own manifest `public/notes/manifest.json`,
  scope `/notes/`, installable on its own; built beside Noesis as a second Vite input; `sw.js` keeps each page for
  offline). It shows the same notes as Second Brain (`lib/knowledge.ts`, now up to 2,000 on the device and from the
  account, with `onNotesChanged` so either app sees the other's changes) grouped as notebooks (`lib/notesBooks.ts`):
  notebooks named after a book (synced preference `noesis:notes-books:v1`, title and author only; a Noesis library
  book is picked from a list), books in the Noesis library ("Open in Noesis" opens `/?book=ID`), books named only by
  title, named notebooks, and the inbox. Notes is notes only: no covers or book details; notebooks show a kind icon.
  Its own icon (`scripts/icons/notes.mjs`: a ruled page with a sprout). A book's page has chapters as
  sections (reading order, notes by page) and a filter (Quotes, Notes, Questions, Ideas); a note has a kind, a quote,
  page, chapter, title, words and tags. Search finds every word across all notes. Second Brain links
  to it. Notes reach a connected Google Drive, OneDrive or Dropbox through Noesis's Backup & Sync the next time Noesis
  syncs. Next: notes in IndexedDB with the person's own storage holding the full set (beyond 2,000), photo of a page
  to text, Kindle and Readwise imports, links to subjects, review cards, Markdown export, three panes on computers.
- Library sections: Borrowed, On this device, External e-books. An external e-book (`format: 'external'`,
  `externalUrl`, `store`) has no file; its cover opens the link (Kindle, Libby, Apple Books…), and Edit details,
  shelves, favorite and Remove work as for books on the device; with no link, opening asks for one.
- Borrowed (`lib/loans.ts`, `Borrowed.tsx`, synced preference `noesis:loans:v1`): e-book, audiobook or paper loans
  with a due date ("Due in 3 days", "Was due Oct 10"). Renew opens `renewLink` (the loan's own link, else the Libby
  shelf for digital copies, else the chosen library's BiblioCommons "checked out" page or website) and asks for the
  new date; Returned with undo. Home shows loans due within three days.
- Introduction (`src/Onboarding.tsx`, `onboarding.css`): new people (nothing in the library, notes or paths) see
  seven full-screen pages in the iOS manner: Welcome; Read what you own; Keep what you read; Learn by asking; Yours,
  and private; Create your account (the Settings sign-in form, opening on Create account; "Not now"); Your own storage
  (the Settings storage rows, optional; "Start reading"). Skip, back, swipe and arrow keys; the step is kept in
  `noesis:intro:v1` (or `done`) so a storage sign-in that leaves the page returns to it. Settings > Account and data >
  Introduction shows it again.
- Rabbit holes (the name people see for subjects / learning paths; the nav key and stored `paths` stay as they
  were): a question can go deeper. `Question.parentId` links it to the one above; `goDeeper` adds up to three
  questions one level down (origin `deeper`, in Later, same area, duplicates left out), `trailOf` gives the way back
  up (loops stop), `deeperFrom` the ones under it, `inTreeOrder` nests them in an area's Later list, and removing a
  question moves the ones under it up a level. The Worker's `/api/question` with `part: 'deeper'` (and the `trail`)
  asks Noema for three narrower questions (`goDeeperFrom`, 300 tokens, 15 s). The question page shows the trail at
  the top; Go deeper leads with the reader's own question ("What do you want to know next?"), which is added under
  this one and opened at once; "Need an idea?" shows Noema's three as chips, kept only when one is chosen; Home offers "Back down the
  rabbit hole" with the deepest open question (`deepestOpen`).
- Staying connected (`lib/cloudProviders.ts`): the one-hour fallback after a failed renewing sign-in now lasts three
  days and only follows a plain refusal (400/401), never a network error (the first version kept it for good, so one
  hiccup left a provider on one-hour connections). Only 400/401 on renewal drops the renewal token; 429 and 5xx are
  tried again. OneDrive renews through the Worker's `/api/cloud-token` when the secret `ONEDRIVE_CLIENT_SECRET` is set
  (`oneDriveRenews` in `/api/config`; Microsoft gives a browser-only registration 24-hour renewals, a Web one 90 days);
  each connection records `viaServer` so older ones keep renewing the way they were made.
- One book, one record (`lib/duplicates.ts`, effect in App): copies of the same file (format, file name ignoring
  case, size) under different ids, from adding a book on two devices or from the library folder on each, are folded
  after any sync. The earliest added (then smallest id) is kept so every device agrees; it takes the furthest reading
  place and anything set on either copy. Notes, review cards, loans, reading diary, rabbit holes' books and the
  folder map move to it, a copy's file moves over when the kept one has none here, and the copy is tombstoned so no
  sync brings it back.
- Libby (`lib/libby.ts`, `LibbyBar.tsx`): Libby's books are DRM-protected and have no public reading API, so they
  can't be read inside Noesis. The Library page has a Libby bar (Shelf, the chosen library in Libby, and a search
  that opens Libby's results for that library, by its `libbyKey`); Explore offers "Search Libby for …".
- Libby highlights (`lib/libbyExport.ts`): Second Brain's "Import highlights" takes Kindle's My Clippings.txt or the
  reading journey Libby exports for a book (Timeline › a book › Export reading journey) as JSON or CSV. Highlights
  come in as highlights; a highlight with a note comes in as a note with the passage as its quote; chapter and
  place are kept, the book is linked when it is in the library, tag `libby`, and ones already there are skipped.
- Lamplight, the family's design system, in its deep (premium) cut (`src/lamplight/`, copied from Proairetos's `src/lamplight/`;
  change it there first): `scheme.ts` makes every color from a room seed (the chosen background) and a lamp seed (the chosen color),
  each moved until it reads 7:1 / 4.5:1 on every surface; `noesis.ts` maps the 13 backgrounds to rooms and the 8 colors to lamps
  (Gold is Noesis's own) and sets Noesis's color names (`--tone-*`, `--paper*`, `--lamp`, `--accent-*`, `--surface-*`) plus `--ll-*`
  through `rootAppearance`; `tokens.css`, `components.css`, `motion.css` and `noesis.css` (the premium finish: a sheen along the top of
  surfaces, the lamp pill holding its own light, finer hairlines, tonal chips and secondary buttons, filled fields, Lucide icons at
  1.7 with the current one lit) load after `design.css`. Tests: `src/__tests__/lamplight.test.ts` (every background × color readable).
- Look (`src/design.css`, loaded last from App): Apple's calm and depth with Material 3's structure, in Noesis's key
  of night blue and one gold light. Tonal surfaces in steps (`--tone-0..4`) instead of outlines, a hairline at most;
  filled pill for the one main action, tonal pills for the rest; filled fields; a gold-tinted pill marks the current
  place in the sidebar and the phone bar; the phone bar is translucent (blur). The default wallpaper is a gradient
  (`--lamplight`: night blue with a gold glow), used wherever no picture is chosen. Books without a cover get a
  typeset one (`BookCover`: title in serif, a rule, the author, a steady hue from the title). Settings' accent and
  background drive every color: `--lamp` is `--accent-mark`, tints use `--lamp-rgb` (`--accent-rgb`), and the
  tones and wallpaper are mixed from `--surface-shell`, so no color in it is fixed. The warm sibling, Lamplight, is kept for Proairetos (Proairetos `docs/design/LAMPLIGHT.md`).
- Colors and wallpaper from Lamplight (Proairetos's palette): the accents are Gold (Noesis's own), Ember, Rose, Heather,
  Ink, Tide, Sage and Pewter (older saved choices move to the nearest: blue to Ink, green to Sage, violet to Heather,
  orange and red to Ember, teal to Tide); backgrounds add Hearth, Dusk and Clay. The default wallpaper is drawn
  (`lib/wallpaper.ts`, in the manner of Proairetos's rooms taken further: a cool room of the background's hue with soft
  blooms of color, a reading lamp as a warm glow with no rings, three silk folds rising toward it with lit top edges,
  the lamp's light falling on their near side, a satin sheen, a shade beneath each, a vignette, dim stars and grain),
  made from the page color, the chosen color and the background's hue (`wallpaperColors`), set as `--lamplight` (tall,
  sidebar) and `--lamplight-wide` (home banner) by App's appearance effect. A chosen picture still replaces it.
- Connected Libby (Borrowed › Connect Libby): the reader makes a setup code in the Libby they are signed in to
  (Menu › Copy To Another Device › Sonos Speakers; the plain option asks for a code from the other device instead) and
  enters it in Noesis, which joins as one more device and receives their library cards. Worker `/api/libby`
  (`src/workerLibby.ts`): `POST /chip?client=dewey`, `POST /chip/clone/code {code}`, the chip again for the joined
  token, then `GET /chip/sync` until a card shows up (three tries); hosts `sentry.libbyapp.com`, then
  `sentry-read.svc.overdrive.com`; headers like Libby's own web app; errors name the step. A code from a signed-out
  Libby is taken ("cloned") but brings no card, and says so. (Tried the other way, Noesis showing a code: Libby kept it
  "retained" and nothing came over.) Unofficial, so it can stop working if Libby changes it; nothing kept on the
  server. The token stays on the device (`noesis:libby-link:v1`, not synced or backed up). `mergeLibbyLoans`
  (`lib/libbyLink.ts`) lays Libby's loans over Borrowed: due dates follow renewals, a hand-typed e-book of the same
  title is joined, a loan Libby no longer has is marked returned; paper copies are untouched. Each Libby loan shows its
  cover and Read, which open the loan in Libby's reader (`libbyapp.com/open/loan/CARD/ID`); Renew opens its page
  (`share.libbyapp.com/title/ID`). Updates when Borrowed opens
  (at most every 15 minutes) or on Update; a refused token asks to connect again. Libby e-books added by hand sit under
  Borrowed too (`isLibbyBook`), joined to their loan by title (`bookForLoan`) or listed without a due date; External
  e-books leaves them out. Libby links open the Libby app on phones (`libbyLinkProps`: Android intent link to
  `com.overdrive.mobile.android.libby` with the web page as fallback; iPhone follows the link in place so the app can
  take it); computers open a new tab. The old Libby card on the Library page is gone (Open Libby sits in Borrowed's
  Libby line; Search Libby stays in Explore).
- Library views (On this device; `BookSection` `views`): Grid (the cover grid), Large (big covers with a calm shadow and a
  thin progress line) and List (one grouped list: small cover, title, author, a progress line, 30% / New / Read, then
  favorite, shelves and remove; hairlines start after the cover). Chosen with a segmented switch in the section
  heading (`.view-switch`, iOS proportions with the lamp-tinted selection), kept on the device in
  `noesis:library-view:v1`. The detail pane beside the shelf works in all three on computers.
- Search: `public/robots.txt`, `public/sitemap.xml` (noesis.proairetos.com: /, /about/, /notes/, privacy, terms), a
  static About page (`public/about/`, real text for search engines, on `legal.css`), and in `index.html` and
  `notes/index.html` a description, canonical address, link-preview tags (`public/social/noesis.png`, 1200×630) and
  WebApplication details (JSON-LD) between `<!-- search -->` markers. Google verification tag already in `index.html`.
- The name is "Rabbit Holes" (title case) wherever it names the feature; the empty list says "Nothing to fall into yet".

- Materials (Lamplight): no blur anywhere. Bars are mica (`--ll-mica`, from the scheme: opaque, the room's hue a little
  stronger than the page, the lamp washing in from above, `--ll-mica-surface` in `src/lamplight/noesis.css`); backdrops are a
  plain dim. `backdrop-filter` is not used.
- Motion between places (`src/lamplight/glide.ts`, `glide.css`, loaded last): one light marks where you are in the dock
  and the sidebar (`useGlide`: a `.nx-glide` span in each nav, placed from the current item's box and sliding on
  `--ll-spring-lively`; springs are in `tokens.css`). Pages slide in the direction of travel (`pageDirection` by nav
  order, `moveTo(change, direction)` sets `data-nav-dir` for the view transition; `.page-content` is `nx-page`, the
  dock and sidebar hold still). On phones the drawer glides in on a spring while the page steps back (scaled and dimmed),
  its places arriving in turn; the top bar is sticky (`.app-shell` uses `overflow: clip`, since `hidden` would trap it),
  clear at rest with the mark before the title, mica and a hairline once the page scrolls (`nx-scrolled`), the title
  keeping one size while scrolling (the owner's choice); the dock steps aside reading down and comes back on the way up, at the top or the foot
  (`nx-tucked`, `useScrollBars`, which reads only the scroll). Motion turned down keeps every change without travel.
