# Noesis project context

This file is the handoff point for future work. Noesis is a separate
development product; it must not change the production IT PATH application.

## Product direction

Noesis is a subject-agnostic, reader-first learning space. A learner imports
an EPUB, PDF, or permitted web source, reads it, highlights passages, writes
notes, asks the tutor about the current reading context, and groups books into
learning paths. A book stays a book; the system may add summaries, questions,
flashcards, and review prompts without forcing the source into fixed lessons.

The visual reference is the dashboard mockup in the conversation: a dark,
calm workspace with a left navigation rail, a resume-reading card, a library
of cover cards with progress, learning-path collections, recent notes, a GAYL
tutor panel, and useful progress metrics.

## Reusable IT PATH reference

Port concepts selectively from `/workspace/itpath-builder`:

- `src/components/layout/side-panel.tsx`: Second Brain popup and text-to-note flow.
- `src/lib/knowledge.functions.ts`: authenticated knowledge storage, extraction,
  and source-grounded search.
- `src/lib/ai/run.server.ts` and `src/lib/ai/gemini-runtime.server.ts`: Gemini
  runtime and guarded AI calls.
- `src/integrations/supabase/client.ts`, `client.server.ts`, and
  `auth-middleware.ts`: Supabase browser/server boundaries.
- `supabase/migrations/20261006000000_create_knowledge_bucket.sql`: knowledge
  storage setup.

Do not copy the IT-specific curriculum, certifications, automotive content,
domain registry, or fixed lesson engines into the universal core. IT can become
an optional future content pack.

## Current repository status

The repository started empty. Commit `23d7574` contains the first responsive
dashboard prototype and README. It currently demonstrates:

- Library cards with progress rings and a resume-reading card.
- Learning path cards.
- Highlight, idea, and question note cards.
- A GAYL context panel and responsive navigation.
- Local EPUB/PDF import into prototype library state.
- A reader-preview panel that marks the next implementation boundary.
- A Second Brain panel with manual notes, text-selection capture, local
  persistence, and optional Supabase anonymous sync.
- A Cloudflare Worker `/api/tutor` route that sends the active book and saved
  notes to Gemini without exposing the API key to the browser.

The import action currently adds a placeholder book. It does not parse EPUB
contents yet. Notes use local storage until Supabase variables and anonymous
auth are available; the migration in `supabase/migrations/` is idempotent for
an existing `knowledge_items` table.

## Installed foundation

Noesis uses React and Vite and now carries the reusable dependency foundation
from IT PATH: Supabase, TanStack Router/Start/Query, Zod, Sonner, Radix UI,
Tailwind utilities, Drizzle, Wrangler, Nitro, Vitest, and the existing UI/data
helpers. EPUB work also has `epubjs` and `jszip` available.

Install with `npm install` or `bun install`. Never commit `.env` or secret
values. `.env.example` documents the browser-safe Supabase values, server-side
Supabase key names, Gemini key names, and `DATABASE_URL`.

## Recommended build order

1. Create the reader data model: `books`, `book_chapters`,
   `reading_progress`, `highlights`, `notes`, `learning_paths`, `path_books`,
   `study_sessions`, and `tutor_threads`.
2. Parse an unencrypted EPUB in the browser or an ingestion worker; retain
   metadata, cover, table of contents, chapter text, and stable source
   locations.
3. Build the persistent reader with resume position, chapter navigation,
   search, appearance controls, highlights, and notes.
4. Expand the Second Brain and let GAYL answer in four scopes: selection,
   chapter, book, and library. Answers should cite source locations. The
   current first slice already supports note capture and book/note context.
5. Add learning paths as user-curated book collections with goal, order, and
   progress. AI suggestions require user approval.
6. Add source-grounded practice and review prompts. Subject-specific applied
   activities can come later through adapters.

## Boundaries

Only import material the learner is permitted to use. DRM-protected EPUBs
cannot be processed. Public links can be inaccessible, paywalled, or dynamic;
the importer needs size, timeout, and source-citation safeguards. AI output
must remain grounded in imported text and should be reviewable before it is
treated as a learning record.

## Verification

The current prototype passes:

```sh
npm run build
npm run lint
git diff --check
```

The empty GitHub repository is configured as `origin`; the initial commit is
local until it is pushed from the authenticated Codespace.
