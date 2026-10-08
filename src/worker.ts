import {
  BOOK_NOTES,
  RESOURCE_KINDS,
  cleanSuggestion,
  pickBook,
  resolvedFromRecord,
  type BookRecord,
} from './lib/pathPlan'

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> }
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
  GEMINI_TUTOR_MODEL?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  // Set to "true" to require a valid Supabase session for /api/tutor.
  TUTOR_REQUIRE_AUTH?: string
  // When set, /api/models is only served to requests sending this token.
  ADMIN_TOKEN?: string
  // Optional: raises the Google Books lookup quota for /api/book.
  GOOGLE_BOOKS_API_KEY?: string
  VITE_GOOGLE_DRIVE_CLIENT_ID?: string
  VITE_ONEDRIVE_CLIENT_ID?: string
  VITE_DROPBOX_APP_KEY?: string
  GOOGLE_DRIVE_CLIENT_ID?: string
  ONEDRIVE_CLIENT_ID?: string
  DROPBOX_APP_KEY?: string
}

const MAX_QUESTION_LENGTH = 2_000
const MAX_CONTEXT_LENGTH = 32_000
const MAX_BOOK_LENGTH = 36_000
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_SEARCH_LENGTH = 160

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, milliseconds = 5_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), milliseconds)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Best-effort per-isolate limiter. It slows scripted abuse of the paid and
// upstream-backed routes; use a Cloudflare rate-limit rule for hard guarantees.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
function rateLimited(request: Request, route: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now()
  if (rateBuckets.size > 5_000)
    for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key)
  const key = `${route}:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}

async function hasValidSession(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const base = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!token || !base || !key) return false
  try {
    const response = await fetchWithTimeout(`${base}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: key },
    })
    return response.ok
  } catch {
    return false
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

type Generated = { ok: true; text: string; model: string } | { ok: false; error: string; status: number }

// One Gemini call with model fallback. Shared by the tutor and review routes.
async function generate(
  env: Env,
  options: { system: string; prompt: string; maxOutputTokens: number; temperature: number; json?: boolean },
): Promise<Generated> {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY is not configured in Cloudflare.', status: 503 }

  const configuredModel = env.GEMINI_TUTOR_MODEL?.trim() || 'gemini-flash-latest'
  const models = [...new Set([configuredModel, 'gemini-flash-latest', 'gemini-2.5-flash'])]
  let lastStatus = 0
  let lastDetail = ''
  for (const model of models) {
    let response: Response
    try {
      response = await fetchWithTimeout(
        `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: options.system }] },
            contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
            generationConfig: {
              temperature: options.temperature,
              maxOutputTokens: options.maxOutputTokens,
              ...(options.json ? { responseMimeType: 'application/json' } : {}),
            },
          }),
        },
        25_000,
      )
    } catch {
      return { ok: false, error: 'Noema could not reach Gemini right now.', status: 502 }
    }

    if (response.ok) {
      const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const text =
        body.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('')
          .trim() ?? ''
      return text ? { ok: true, text, model } : { ok: false, error: 'Gemini returned an empty answer.', status: 502 }
    }

    lastStatus = response.status
    try {
      const providerError = (await response.clone().json()) as { error?: { message?: string } }
      lastDetail = providerError.error?.message?.slice(0, 240) ?? ''
    } catch {
      lastDetail = ''
    }
    if (response.status === 429) return { ok: false, error: 'Gemini is busy. Try again in a moment.', status: 429 }
    if (![404, 500, 502, 503, 504].includes(response.status)) break
  }
  return {
    ok: false,
    error: `Gemini request failed (${lastStatus}) after trying available tutor models.${lastDetail ? ` ${lastDetail}` : ''}`,
    status: 502,
  }
}

// Rate limit and (optionally) require a signed-in session for AI routes.
async function guardAi(
  request: Request,
  env: Env,
  route: string,
  limit: number,
  busy: string,
  signIn: string,
): Promise<Response | null> {
  if (rateLimited(request, route, limit)) return json({ ok: false, error: busy }, 429)
  if (env.TUTOR_REQUIRE_AUTH?.trim().toLowerCase() === 'true' && !(await hasValidSession(request, env))) {
    return json({ ok: false, error: signIn }, 401)
  }
  return null
}

async function answerTutor(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'tutor',
    20,
    'Too many questions. Try again in a minute.',
    'Sign in to ask Noema.',
  )
  if (refused) return refused
  let input: { question?: unknown; context?: unknown; book?: unknown; length?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }

  const question = typeof input.question === 'string' ? input.question.trim().slice(0, MAX_QUESTION_LENGTH) : ''
  if (question.length < 2) return json({ ok: false, error: 'Ask Noema a question first.' }, 400)

  const context = typeof input.context === 'string' ? input.context.slice(0, MAX_CONTEXT_LENGTH) : ''
  const book = typeof input.book === 'string' ? input.book.slice(0, MAX_BOOK_LENGTH) : ''
  const system = [
    'You are Noema, a calm and practical learning guide inside Noesis.',
    'Answer the learner directly in plain text. Use the supplied book and Second Brain context first.',
    'When the context does not contain enough evidence, say that clearly and offer a useful next step.',
    'Do not invent quotations or pretend to have read a book that is not in the supplied context.',
    'For borrowed or hosted books, distinguish metadata from the actual text. Explain exact passages only when the learner supplies the passage or notes. Never claim access to protected reader contents; ask the learner to paste a passage when needed.',
    "Treat the supplied visible reading text and selected passage as the learner's immediate context. Prefer that text over general book metadata or distant excerpts.",
    'When relevant text is supplied, explain it from that text, mention the current chapter or page when available, and distinguish direct evidence from interpretation.',
    'Book excerpts are labelled [Section N]. When you rely on one, cite it as (Section N) so the learner can find it, and never cite a section you were not given.',
    'Keep the answer focused unless the learner asks for a deep explanation.',
  ].join(' ')
  const prompt = [
    `Current book context:\n${book || '(none)'}`,
    `Second Brain notes:\n${context || '(none)'}`,
    `Learner question:\n${question}`,
  ].join('\n\n')

  const length = input.length === 'concise' || input.length === 'detailed' ? input.length : 'balanced'
  const lengthNote =
    length === 'concise'
      ? 'Keep the answer short: two or three sentences unless the learner asks for more.'
      : length === 'detailed'
        ? 'Give a thorough, well-organized answer with the reasoning and relevant detail.'
        : ''
  const result = await generate(env, {
    system: lengthNote ? `${system} ${lengthNote}` : system,
    prompt,
    maxOutputTokens: { concise: 450, balanced: 800, detailed: 1500 }[length],
    temperature: 0.35,
  })
  return result.ok
    ? json({ ok: true, text: result.text, model: result.model })
    : json({ ok: false, error: result.error }, result.status)
}

async function linkWorks(url: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NoesisLinkCheck/1.0)', range: 'bytes=0-0' },
      },
      4_000,
    )
    void response.body?.cancel()
    // A site that blocks bots (403/429) is still a real site; only gone or broken pages are dropped.
    return !(response.status === 404 || response.status === 410 || response.status >= 500)
  } catch {
    return false
  }
}

// Turns a learner's goal into three structured paths, plus books and free
// resources to look up. Books are verified one by one through /api/book.
async function planPath(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'path',
    6,
    'Too many requests. Try again in a few minutes.',
    'Sign in to create learning paths.',
  )
  if (refused) return refused
  let input: { goal?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }
  const goal = typeof input.goal === 'string' ? input.goal.trim().slice(0, 400) : ''
  if (goal.length < 8) return json({ ok: false, error: 'Describe what you want to learn in a sentence or two.' }, 400)

  const system = [
    'You design learning paths for a reading app. Reply with JSON only, in exactly this shape:',
    '{"paths":[{"title":"","summary":"","weeks":"","level":"","milestones":[{"title":"","topics":[""]}]}],',
    '"books":[{"title":"","author":"","note":""}],',
    '"resources":[{"title":"","publisher":"","url":"","kind":"","note":""}]}.',
    "Give exactly three paths for the learner's goal, each with a different emphasis that fits the goal (for example foundations, career or exam preparation, and hands-on practice).",
    'Each path has five milestones ordered from basics to advanced, and each milestone has two to four short topics. "weeks" is a realistic range such as "6–8 weeks". "level" is Beginner, Intermediate, or Advanced.',
    'List eight real, published books you are confident exist, as a mix of overview, practical, and reference titles, with the author\'s name. "note" is one of: ' +
      BOOK_NOTES.join(', ') +
      '.',
    'List four to six free, reputable resources such as official courses, documentation, university open courseware, or well-known video series. "kind" is one of: ' +
      RESOURCE_KINDS.join(', ') +
      '.',
    "Never invent a book, an author, or a web address. If you are not sure of an exact address, use the provider's main website address.",
  ].join(' ')
  const result = await generate(env, {
    system,
    prompt: `Learner's goal: ${goal}`,
    maxOutputTokens: 4_000,
    temperature: 0.5,
    json: true,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return json({ ok: false, error: 'Noema returned a plan in an unexpected format. Try again.' }, 502)
  }
  const suggestion = cleanSuggestion(goal, parsed)
  if (!suggestion)
    return json(
      { ok: false, error: 'Noema could not build a path for that. Try describing your goal differently.' },
      502,
    )
  const checks = await Promise.all(suggestion.resources.map((resource) => linkWorks(resource.url)))
  suggestion.resources = suggestion.resources.filter((_, index) => checks[index])
  return json({ ok: true, suggestion })
}

type GoogleVolume = {
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publishedDate?: string
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    averageRating?: number
    ratingsCount?: number
    infoLink?: string
    description?: string
  }
  saleInfo?: { saleability?: string; buyLink?: string; listPrice?: { amount?: number; currencyCode?: string } }
  accessInfo?: { publicDomain?: boolean; epub?: { isAvailable?: boolean; downloadLink?: string } }
}

function secure(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(/^http:\/\//, 'https://')
}

function toRecord(volume: GoogleVolume): BookRecord | null {
  const info = volume.volumeInfo
  if (!info?.title) return null
  const ids = info.industryIdentifiers ?? []
  const price = volume.saleInfo?.listPrice
  let formatted: string | undefined
  if (price?.amount && price.currencyCode) {
    try {
      formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currencyCode }).format(
        price.amount,
      )
    } catch {
      formatted = undefined
    }
  }
  const year = Number.parseInt(info.publishedDate?.slice(0, 4) ?? '', 10)
  return {
    title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title,
    authors: info.authors ?? [],
    year: Number.isFinite(year) ? year : undefined,
    isbn10: ids.find((id) => id.type === 'ISBN_10')?.identifier,
    isbn13: ids.find((id) => id.type === 'ISBN_13')?.identifier,
    coverUrl: secure(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    rating: typeof info.averageRating === 'number' ? info.averageRating : undefined,
    ratingsCount: typeof info.ratingsCount === 'number' ? info.ratingsCount : undefined,
    price: formatted,
    description: info.description?.slice(0, 320),
    buyLink: volume.saleInfo?.saleability === 'FOR_SALE' ? secure(volume.saleInfo.buyLink) : undefined,
    infoUrl: secure(info.infoLink),
    freeUrl: volume.accessInfo?.publicDomain && volume.accessInfo.epub?.isAvailable ? secure(info.infoLink) : undefined,
  }
}

// Finds the real catalogue record for a book the AI named. Answers
// { book: null } when nothing matches closely enough, and a 502 when the
// catalogue itself could not be reached.
async function lookupBook(request: Request, env: Env): Promise<Response> {
  if (rateLimited(request, 'book', 80))
    return json({ ok: false, error: 'Too many lookups. Try again in a minute.' }, 429)
  const params = new URL(request.url).searchParams
  const title = params.get('title')?.trim().slice(0, 140) ?? ''
  const author = params.get('author')?.trim().slice(0, 100) ?? ''
  const note = params.get('note')?.trim().slice(0, 40) || undefined
  if (title.length < 2) return json({ ok: false, error: 'A title is required.' }, 400)
  const query = `intitle:${title}${author ? ` inauthor:${author}` : ''}`
  const key = env.GOOGLE_BOOKS_API_KEY?.trim()
  const fields =
    'items(volumeInfo(title,subtitle,authors,publishedDate,industryIdentifiers,imageLinks,averageRating,ratingsCount,infoLink,description),saleInfo(saleability,buyLink,listPrice),accessInfo(publicDomain,epub))'
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books&fields=${encodeURIComponent(fields)}${key ? `&key=${encodeURIComponent(key)}` : ''}`
  let volumes: GoogleVolume[]
  try {
    const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 6_000)
    if (!response.ok) return json({ ok: false, error: 'Book lookup is unavailable right now.' }, 502)
    volumes = ((await response.json()) as { items?: GoogleVolume[] }).items ?? []
  } catch {
    return json({ ok: false, error: 'Book lookup is unavailable right now.' }, 502)
  }
  const records = volumes.flatMap((volume) => {
    const record = toRecord(volume)
    return record ? [record] : []
  })
  const picked = pickBook(records, title, author)
  return json({ ok: true, book: picked ? resolvedFromRecord(picked, note) : null })
}

const MAX_PASSAGE_LENGTH = 6_000

// Drafts study questions from one passage. The client shows them to the
// learner, who approves each one before it becomes a review card.
async function draftReviewCards(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'review',
    10,
    'Too many requests. Try again in a minute.',
    'Sign in to create review questions.',
  )
  if (refused) return refused
  let input: { passage?: unknown; bookTitle?: unknown; count?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }
  const passage = typeof input.passage === 'string' ? input.passage.trim().slice(0, MAX_PASSAGE_LENGTH) : ''
  if (passage.length < 40) return json({ ok: false, error: 'Select a longer passage to make questions from.' }, 400)
  const bookTitle = typeof input.bookTitle === 'string' ? input.bookTitle.slice(0, 200) : ''
  const requested = typeof input.count === 'number' && Number.isFinite(input.count) ? Math.round(input.count) : 3
  const count = Math.max(1, Math.min(5, requested))

  const system = [
    'You write review questions for a learner, grounded only in the passage supplied.',
    'Return a JSON array of objects with "question" and "answer" strings, and nothing else.',
    'Every question must be answerable from the passage alone, without outside knowledge or the surrounding book.',
    'Prefer questions that test understanding of an idea over recalling exact wording. Keep each answer to one to three sentences.',
    'Do not invent facts or quotations. If the passage supports fewer questions than requested, return fewer.',
  ].join(' ')
  const prompt = `${bookTitle ? `Book: ${bookTitle}\n` : ''}Write up to ${count} questions.\n\nPassage:\n${passage}`
  const result = await generate(env, { system, prompt, maxOutputTokens: 900, temperature: 0.3, json: true })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return json({ ok: false, error: 'Noema returned questions in an unexpected format. Try again.' }, 502)
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { cards?: unknown } | null)?.cards
  const cards = (Array.isArray(list) ? list : [])
    .map((item) => item as { question?: unknown; answer?: unknown })
    .filter(
      (item) =>
        typeof item?.question === 'string' &&
        typeof item?.answer === 'string' &&
        item.question.trim() &&
        item.answer.trim(),
    )
    .slice(0, count)
    .map((item) => ({
      question: String(item.question).trim().slice(0, 400),
      answer: String(item.answer).trim().slice(0, 800),
    }))
  return cards.length > 0
    ? json({ ok: true, cards })
    : json({ ok: false, error: 'Noema could not make questions from that passage.' }, 502)
}

type SearchResult = {
  id: string
  title: string
  author: string
  year?: number
  coverUrl?: string
  description?: string
  source: string
  sourceUrl: string
  free: boolean
  format: string
  downloadUrl?: string
  readerUrl?: string
  accessType?: 'public' | 'borrow'
  kind: 'book' | 'article'
}

async function searchFreeResources(request: Request): Promise<Response> {
  if (rateLimited(request, 'search', 30))
    return json({ ok: false, error: 'Too many searches. Try again in a minute.' }, 429)
  try {
    const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, MAX_SEARCH_LENGTH) ?? ''
    if (query.length < 2) return json({ ok: false, error: 'Enter at least two characters to search.' }, 400)
    const encoded = encodeURIComponent(query)
    const openLibrary = fetchWithTimeout(
      `https://openlibrary.org/search.json?q=${encoded}&limit=12&fields=key,title,author_name,cover_i,first_publish_year`,
      { headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as {
          docs?: Array<{
            key?: string
            title?: string
            author_name?: string[]
            cover_i?: number
            first_publish_year?: number
          }>
        }
        return (body.docs ?? [])
          .filter((item) => item && typeof item.title === 'string')
          .map((item, index): SearchResult => ({
            id: item.key ?? `${item.title}-${index}`,
            title: item.title ?? 'Untitled',
            author: item.author_name?.slice(0, 2).join(', ') || 'Unknown author',
            year: item.first_publish_year,
            coverUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : undefined,
            source: 'Open Library',
            sourceUrl: `https://openlibrary.org${item.key ?? ''}`,
            free: false,
            format: 'Book metadata',
            kind: 'book',
          }))
      })
      .catch(() => [] as SearchResult[])
    const gutenberg = fetchWithTimeout(`https://gutendex.com/books/?search=${encoded}`, {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as {
          results?: Array<{
            id?: number
            title?: string
            authors?: Array<{ name?: string }>
            copyright?: boolean
            formats?: Record<string, string>
          }>
        }
        return (body.results ?? [])
          .filter((item) => item && typeof item.title === 'string')
          .slice(0, 12)
          .map((item): SearchResult => ({
            id: String(item.id ?? item.title),
            title: item.title ?? 'Untitled',
            author:
              item.authors
                ?.map((author) => author?.name)
                .filter(Boolean)
                .join(', ') || 'Unknown author',
            coverUrl: item.formats?.['image/jpeg'],
            source: 'Project Gutenberg',
            sourceUrl: `https://www.gutenberg.org/ebooks/${item.id ?? ''}`,
            downloadUrl: item.formats?.['application/epub+zip'] || item.formats?.['application/pdf'],
            free: item.copyright === false,
            format: item.formats?.['application/epub+zip'] ? 'EPUB' : 'Public domain',
            kind: 'book',
          }))
      })
      .catch(() => [] as SearchResult[])
    const academic = fetchWithTimeout(
      `https://api.openalex.org/works?search=${encoded}&filter=is_oa:true&per-page=12&mailto=noesis@proairetos.com`,
      { headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as {
          results?: Array<{
            id?: string
            title?: string
            publication_year?: number
            authorships?: Array<{ author?: { display_name?: string } }>
            doi?: string
            primary_location?: { landing_page_url?: string; pdf_url?: string; source?: { display_name?: string } }
            open_access?: { is_oa?: boolean }
          }>
        }
        return (body.results ?? [])
          .filter((item) => item && typeof item.title === 'string')
          .map((item, index): SearchResult => ({
            id: item.id ?? `${item.title}-${index}`,
            title: item.title ?? 'Untitled article',
            author:
              item.authorships
                ?.slice(0, 3)
                .map((entry) => entry.author?.display_name)
                .filter(Boolean)
                .join(', ') || 'Unknown author',
            year: item.publication_year,
            source: 'OpenAlex',
            sourceUrl: item.primary_location?.landing_page_url || item.doi || item.id || '',
            downloadUrl: item.primary_location?.pdf_url,
            free: item.open_access?.is_oa === true,
            format: item.primary_location?.pdf_url ? 'Open-access PDF' : 'Academic article',
            kind: 'article',
          }))
      })
      .catch(() => [] as SearchResult[])
    const academicFallback = fetchWithTimeout(
      `https://api.crossref.org/works?query=${encoded}&filter=type:journal-article&rows=12`,
      { headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as {
          message?: {
            items?: Array<{
              DOI?: string
              title?: string[]
              author?: Array<{ given?: string; family?: string }>
              published?: { 'date-parts'?: number[][] }
              URL?: string
              link?: Array<{ URL?: string; 'content-type'?: string }>
              license?: Array<{ URL?: string }>
            }>
          }
        }
        return (body.message?.items ?? [])
          .filter((item) => item && item.title?.[0])
          .map((item, index): SearchResult => {
            const pdf = item.link?.find((link) => link['content-type']?.toLowerCase().includes('pdf'))?.URL
            return {
              id: item.DOI ?? `${item.title?.[0]}-${index}`,
              title: item.title?.[0] ?? 'Journal article',
              author:
                item.author
                  ?.slice(0, 3)
                  .map((author) => [author.given, author.family].filter(Boolean).join(' '))
                  .filter(Boolean)
                  .join(', ') || 'Unknown author',
              year: item.published?.['date-parts']?.[0]?.[0],
              source: 'Crossref',
              sourceUrl: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
              downloadUrl: pdf,
              free: Boolean(pdf || item.license?.length),
              format: pdf ? 'Journal PDF' : 'Journal article',
              kind: 'article',
            }
          })
      })
      .catch(() => [] as SearchResult[])
    const archive = fetchWithTimeout(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${query} AND mediatype:texts`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=description&fl[]=collection&rows=12&page=1&output=json`,
      { headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as {
          response?: {
            docs?: Array<{
              identifier?: string
              title?: string
              creator?: string | string[]
              year?: number | string
              description?: string | string[]
              collection?: string | string[]
            }>
          }
        }
        return (body.response?.docs ?? [])
          .filter((item) => item.identifier && item.title)
          .map((item): SearchResult => {
            const identifier = item.identifier ?? ''
            const collections = Array.isArray(item.collection) ? item.collection : [item.collection ?? '']
            const restricted = collections.some((value) => /inlibrary|lending|printdisabled|borrow/i.test(value))
            const description = Array.isArray(item.description) ? item.description.join(' ') : item.description
            return {
              id: identifier,
              title: item.title ?? 'Internet Archive item',
              author: Array.isArray(item.creator)
                ? item.creator.slice(0, 2).join(', ')
                : item.creator || 'Unknown author',
              year: typeof item.year === 'string' ? Number.parseInt(item.year, 10) || undefined : item.year,
              description: typeof description === 'string' ? description.slice(0, 1_200) : undefined,
              source: 'Internet Archive',
              sourceUrl: `https://archive.org/details/${identifier}`,
              readerUrl: `https://archive.org/embed/${identifier}`,
              coverUrl: `https://archive.org/services/img/${identifier}`,
              free: !restricted,
              format: restricted ? 'Borrowed reader' : 'Internet Archive reader',
              accessType: restricted ? 'borrow' : 'public',
              kind: 'book',
            }
          })
      })
      .catch(() => [] as SearchResult[])
    const [library, gutenbergResults, academicResults, academicFallbackResults, archiveResults] = await Promise.all([
      openLibrary,
      gutenberg,
      academic,
      academicFallback,
      archive,
    ])
    const academicResultsToUse = academicResults.length > 0 ? academicResults : academicFallbackResults
    return json({ ok: true, results: [...gutenbergResults, ...academicResultsToUse, ...archiveResults, ...library] })
  } catch {
    return json({ ok: false, error: 'Free-resource search is temporarily unavailable.' }, 502)
  }
}

const RESOURCE_HOSTS = [
  'gutenberg.org',
  'archive.org',
  'arxiv.org',
  'nih.gov',
  'pmc.ncbi.nlm.nih.gov',
  'zenodo.org',
  'doaj.org',
]

const MAX_RESOURCE_BYTES = 80 * 1024 * 1024
const MAX_RESOURCE_REDIRECTS = 3

function isAllowedResource(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    RESOURCE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  )
}

async function proxyResource(request: Request): Promise<Response> {
  if (rateLimited(request, 'resource', 20))
    return json({ ok: false, error: 'Too many downloads. Try again in a minute.' }, 429)
  const target = new URL(request.url).searchParams.get('url')
  if (!target) return json({ ok: false, error: 'A resource URL is required.' }, 400)
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return json({ ok: false, error: 'The resource URL is invalid.' }, 400)
  }
  const refusal = json(
    { ok: false, error: 'This resource cannot be imported directly. Open the source page instead.' },
    403,
  )
  if (!isAllowedResource(url)) return refusal

  // Follow redirects by hand so every hop stays on the allowlist.
  let response: Response
  try {
    for (let hop = 0; ; hop += 1) {
      response = await fetchWithTimeout(
        url,
        { headers: { accept: 'application/epub+zip,application/pdf,*/*' }, redirect: 'manual' },
        20_000,
      )
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) break
      if (hop >= MAX_RESOURCE_REDIRECTS) return json({ ok: false, error: 'The source redirected too many times.' }, 502)
      url = new URL(location, url)
      if (!isAllowedResource(url)) return refusal
    }
  } catch {
    return json({ ok: false, error: 'The source did not respond in time.' }, 502)
  }
  if (!response.ok || !response.body) return json({ ok: false, error: `The source returned ${response.status}.` }, 502)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESOURCE_BYTES)
    return json({ ok: false, error: 'This file is too large to import.' }, 413)

  let received = 0
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > MAX_RESOURCE_BYTES) controller.error(new Error('resource too large'))
      else controller.enqueue(chunk)
    },
  })
  const headers = new Headers({
    'cache-control': 'public, max-age=3600',
    'content-type': response.headers.get('content-type') || 'application/octet-stream',
  })
  return new Response(response.body.pipeThrough(limiter), { status: 200, headers })
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({
        ok: true,
        googleDriveClientId: env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() || env.GOOGLE_DRIVE_CLIENT_ID?.trim() || '',
        oneDriveClientId: env.VITE_ONEDRIVE_CLIENT_ID?.trim() || env.ONEDRIVE_CLIENT_ID?.trim() || '',
        dropboxAppKey: env.VITE_DROPBOX_APP_KEY?.trim() || env.DROPBOX_APP_KEY?.trim() || '',
      })
    }
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        ok: true,
        worker: 'noesis-dev',
        geminiConfigured: Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()),
      })
    }
    if (url.pathname === '/api/models' && request.method === 'GET') {
      const adminToken = env.ADMIN_TOKEN?.trim()
      if (!adminToken || request.headers.get('x-admin-token') !== adminToken)
        return json({ ok: false, error: 'Not found.' }, 404)
      const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
      if (!apiKey) return json({ ok: false, error: 'GEMINI_API_KEY is not configured.' }, 503)
      let response: Response
      try {
        response = await fetchWithTimeout(`${GEMINI_BASE}/models`, { headers: { 'x-goog-api-key': apiKey } })
      } catch {
        return json({ ok: false, error: 'Gemini model discovery could not reach Google.' }, 502)
      }
      let body: { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
      try {
        body = (await response.json()) as typeof body
      } catch {
        return json(
          { ok: false, error: `Gemini model discovery returned a non-JSON response (${response.status}).` },
          502,
        )
      }
      if (!response.ok) return json({ ok: false, error: `Gemini model discovery failed (${response.status}).` }, 502)
      const models = (body.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
        .map((model) => (model.name ?? '').replace(/^models\//, ''))
        .filter(Boolean)
      return json({ ok: true, models })
    }
    if (url.pathname === '/api/tutor') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return answerTutor(request, env)
    }
    if (url.pathname === '/api/review') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return draftReviewCards(request, env)
    }
    if (url.pathname === '/api/path') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return planPath(request, env)
    }
    if (url.pathname === '/api/book') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return lookupBook(request, env)
    }
    if (url.pathname === '/api/search' && request.method === 'GET') return searchFreeResources(request)
    if (url.pathname === '/api/resource' && request.method === 'GET') return proxyResource(request)
    return env.ASSETS.fetch(request)
  },
}

export default worker
