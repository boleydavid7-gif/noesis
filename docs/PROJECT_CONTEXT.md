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
- Cloud Backup can connect a learner's own Google Drive, OneDrive, or Dropbox.
  It syncs a manifest and separate EPUB files, then merges them on another
  device. ZIP remains an optional manual export only.

## Installed foundation

Noesis uses React and Vite with Supabase, epubjs, jszip, and Wrangler. Install
with `npm install` or `bun install`. Never commit `.env` or secret values.

## Next build order

Done recently: whole-book search with jump-to-result, BM25 passage retrieval
for Noema (answers cite `(Section N)`), deletion tombstones in both sync
manifests, and review prompts with a spaced-repetition queue.

1. Sync review cards (they are local to the browser today) and include them in
   backups and tombstones.
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

## Verification

The current source passes `npm run typecheck`, `npm run build`, `npm run lint`,
and a Wrangler dry run. The live health endpoint is
`/api/health`; free-resource search is `/api/search?q=...`.
