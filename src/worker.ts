import {
  buyLinks,
  isPublicHttps,
  matchScore,
  pickBook,
  resolvedFromRecord,
  type BookRecord,
  type RatingSource,
} from './lib/pathPlan'
import { handlePasskey, sendReviewReminders } from './workerAccount'
import {
  cleanQuestionReply,
  cleanSubjectReply,
  isoMinutes,
  youtubeId,
  type PickDraft,
  type PickType,
} from './lib/subjects'

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
  // Optional: lets Google Drive connections renew themselves (Google needs the secret for that).
  GOOGLE_DRIVE_CLIENT_SECRET?: string
  // Secret: passkey sign-in and review reminders read and write their tables with it (never sent to the app).
  SUPABASE_SERVICE_ROLE_KEY?: string
  // Review reminders with Noesis closed (Web Push). The public key is shown to the app; the private one is a secret.
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  // Optional: finds videos for a question by search (YouTube Data API). Without it, only links Noema names are
  // checked and kept.
  YOUTUBE_API_KEY?: string
}

const RETRY_PAUSE_MS = 1_500
const MAX_QUESTION_LENGTH = 2_000
const MAX_CONTEXT_LENGTH = 32_000
const MAX_BOOK_LENGTH = 36_000
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_SEARCH_LENGTH = 160
// Wikimedia asks callers to name themselves with a way to reach them.
const WIKI_AGENT = 'Noesis/1.0 (https://noesis.proairetos.com; reading app)'

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

// Room for thinking when a model will not turn it off.
const THINKING_ROOM = 4_096

type Generated = { ok: true; text: string; model: string } | { ok: false; error: string; status: number }

// One Gemini call with model fallback. Shared by the tutor and review routes.
async function generate(
  env: Env,
  options: {
    system: string
    prompt: string
    maxOutputTokens: number
    temperature: number
    json?: boolean
    timeoutMs?: number
  },
): Promise<Generated> {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY is not configured in Cloudflare.', status: 503 }

  const configuredModel = env.GEMINI_TUTOR_MODEL?.trim() || 'gemini-flash-latest'
  // When the main model is overloaded the lighter ones usually still answer.
  const models = [
    ...new Set([
      configuredModel,
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-flash-lite-latest',
    ]),
  ]
  // These mean "try another model" (a model can be missing, rate limited, or overloaded).
  const tryNext = new Set([404, 429, 500, 502, 503, 504])
  const busy = new Set([429, 500, 502, 503, 504])
  let lastStatus = 0
  let lastDetail = ''
  const timeout = options.timeoutMs ?? 25_000
  // A model that does not answer in time (or a dropped connection) is a reason to try the next one, not to stop.
  let timedOut = false
  const deadline = Date.now() + timeout * 3
  for (let round = 0; round < 2; round += 1) {
    let sawBusy = false
    for (const model of models) {
      // Never keep the reader waiting for more than about three tries' worth of time.
      if (timedOut && Date.now() > deadline) break
      // Gemini's thinking is spent from the same allowance as the answer, which cut answers off partway.
      // Thinking is turned off (Pro models cannot turn it off, so they get a small budget). A model that
      // refuses the setting is asked again without it and with room for its thinking, and an answer that
      // still stops at the limit is asked for once more with twice the room.
      const call = (thinking: boolean, room: number, wait = timeout) =>
        fetchWithTimeout(
          `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: options.system }] },
              contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
              generationConfig: {
                temperature: options.temperature,
                maxOutputTokens: room,
                ...(thinking ? { thinkingConfig: { thinkingBudget: /pro/i.test(model) ? 128 : 0 } } : {}),
                ...(options.json ? { responseMimeType: 'application/json' } : {}),
              },
            }),
          },
          wait,
        )
      const read = async (reply: Response) => {
        const body = (await reply.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string; thought?: boolean }> }
            finishReason?: string
          }>
        }
        const candidate = body.candidates?.[0]
        const text =
          candidate?.content?.parts
            ?.filter((part) => !part.thought)
            .map((part) => part.text ?? '')
            .join('')
            .trim() ?? ''
        return { text, cutOff: candidate?.finishReason === 'MAX_TOKENS' }
      }
      let response: Response
      let room = options.maxOutputTokens
      let thinking = true
      try {
        response = await call(thinking, room)
        if (response.status === 400) {
          thinking = false
          room = options.maxOutputTokens + THINKING_ROOM
          response = await call(thinking, room)
        }
        if (response.ok) {
          let answer = await read(response)
          if (answer.cutOff) {
            // A longer answer takes longer to write, so it gets more time.
            const again = await call(thinking, room * 2 + THINKING_ROOM, timeout * 2).catch(() => null)
            if (again?.ok) {
              const longer = await read(again)
              if (longer.text) answer = longer
            }
            // Half of a JSON answer cannot be read: another model may manage it whole.
            if (answer.cutOff && options.json) {
              timedOut = true
              continue
            }
          }
          return answer.text
            ? { ok: true, text: answer.text, model }
            : { ok: false, error: 'Gemini returned an empty answer.', status: 502 }
        }
      } catch {
        timedOut = true
        continue
      }

      lastStatus = response.status
      try {
        const providerError = (await response.clone().json()) as { error?: { message?: string } }
        lastDetail = providerError.error?.message?.slice(0, 240) ?? ''
      } catch {
        lastDetail = ''
      }
      if (!tryNext.has(response.status)) {
        return {
          ok: false,
          error: `Gemini request failed (${lastStatus}).${lastDetail ? ` ${lastDetail}` : ''}`,
          status: 502,
        }
      }
      if (busy.has(response.status)) sawBusy = true
    }
    // Every model was busy: wait a moment and go around once more.
    if (!sawBusy || round === 1) break
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS))
  }
  if (timedOut && !lastStatus) {
    return { ok: false, error: 'Noema took too long to answer. Try again in a moment.', status: 504 }
  }
  if (busy.has(lastStatus)) {
    return { ok: false, error: 'Noema is very busy right now. Please try again in a moment.', status: 503 }
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
    'Book excerpts are labeled [Section N]. When you rely on one, cite it as (Section N) so the learner can find it, and never cite a section you were not given.',
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

// Before planning, helps the learner say what they actually mean: a broad goal
// such as "psychology" is split into specific focus areas to choose from.
async function clarifyGoal(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'clarify',
    12,
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
  if (goal.length < 3) return json({ ok: false, error: 'Tell Noema what you want to learn.' }, 400)
  const result = await generate(env, {
    system: [
      'You help a learner narrow down what they want to learn. Reply with JSON only, in exactly this shape:',
      '{"topic":"","broad":true,"focuses":[{"title":"","description":"","covers":[""],"fits":""}]}.',
      '"topic" is the subject in two to five words. "broad" is true when the goal is a whole field that contains several distinct areas (such as psychology, finance, or programming) and false when it is already specific.',
      'List six to eight "focuses": distinct, specific areas within the subject that someone might want to study, ordered from the usual starting point to more specialized areas. Include a foundational or introductory focus first. "title" is two to five words; "description" is one or two plain sentences saying what studying this area is about; "covers" lists three or four of the main topics someone would study; "fits" is one short sentence on who it suits or what it leads to.',
      'If the goal is already specific, list focuses that are different angles on it (for example theory, practice, exam preparation).',
    ].join(' '),
    prompt: `Learner's goal: ${goal}`,
    maxOutputTokens: 2_500,
    temperature: 0.4,
    json: true,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)
  let parsed: { topic?: unknown; broad?: unknown; focuses?: unknown }
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
  }
  const focuses = (Array.isArray(parsed.focuses) ? parsed.focuses : [])
    .flatMap((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      const title = typeof row.title === 'string' ? row.title.trim().slice(0, 60) : ''
      const description = typeof row.description === 'string' ? row.description.trim().slice(0, 260) : ''
      const fits = typeof row.fits === 'string' ? row.fits.trim().slice(0, 160) : ''
      const covers = (Array.isArray(row.covers) ? row.covers : [])
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim().slice(0, 60))
        .slice(0, 5)
      return title ? [{ title, description, covers, fits }] : []
    })
    .slice(0, 8)
  if (focuses.length < 2)
    return json({ ok: false, error: 'Noema could not narrow that down. Try describing it differently.' }, 502)
  const topic = typeof parsed.topic === 'string' ? parsed.topic.trim().slice(0, 60) : ''
  return json({ ok: true, topic, broad: parsed.broad !== false, focuses })
}

// Looks a word up in a free dictionary, so the reader can show a meaning without leaving the page.
async function defineWord(request: Request): Promise<Response> {
  if (rateLimited(request, 'define', 40))
    return json({ ok: false, error: 'Too many lookups. Try again in a minute.' }, 429)
  const word = (new URL(request.url).searchParams.get('word') ?? '').trim().toLowerCase().slice(0, 40)
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(word)) return json({ ok: false, error: 'Select a single word.' }, 400)
  try {
    const response = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/v2/entries/en/${encodeURIComponent(word)}`,
      { headers: { accept: 'application/json' } },
      4_000,
    )
    if (response.status === 404) return json({ ok: true, found: false, word })
    if (!response.ok) return json({ ok: false, error: 'The dictionary is unavailable right now.' }, 502)
    const entries = (await response.json()) as Array<{
      phonetic?: string
      meanings?: Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string; example?: string }> }>
    }>
    const meanings = (entries[0]?.meanings ?? []).slice(0, 3).flatMap((meaning) => {
      const first = meaning.definitions?.[0]
      return first?.definition
        ? [
            {
              partOfSpeech: meaning.partOfSpeech ?? '',
              definition: first.definition.slice(0, 300),
              example: first.example?.slice(0, 200),
            },
          ]
        : []
    })
    return json({ ok: true, found: meanings.length > 0, word, phonetic: entries[0]?.phonetic ?? '', meanings })
  } catch {
    return json({ ok: false, error: 'The dictionary is unavailable right now.' }, 502)
  }
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

type OpenLibraryDoc = {
  title?: string
  author_name?: string[]
  ratings_average?: number
  ratings_count?: number
  cover_i?: number
  first_publish_year?: number
}

// Open Library's own reader ratings: a second source next to Google Books.
async function openLibraryMatch(
  title: string,
  author: string,
): Promise<{ doc: OpenLibraryDoc; rating?: RatingSource } | null> {
  try {
    const params = new URLSearchParams({
      title,
      limit: '6',
      fields: 'title,author_name,ratings_average,ratings_count,cover_i,first_publish_year',
    })
    if (author) params.set('author', author)
    const response = await fetchWithTimeout(
      `https://openlibrary.org/search.json?${params.toString()}`,
      { headers: { accept: 'application/json' } },
      4_000,
    )
    if (!response.ok) return null
    const docs = ((await response.json()) as { docs?: OpenLibraryDoc[] }).docs ?? []
    const best = docs
      .filter((doc) => doc.title)
      .map((doc) => ({
        doc,
        score: matchScore({ title: doc.title ?? '', authors: doc.author_name ?? [] }, title, author),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.doc.ratings_count ?? 0) - (a.doc.ratings_count ?? 0))[0]
    if (!best) return null
    const { ratings_average: average, ratings_count: count } = best.doc
    return {
      doc: best.doc,
      rating:
        typeof average === 'number' && typeof count === 'number'
          ? { source: 'Open Library', average, count }
          : undefined,
    }
  } catch {
    return null
  }
}

function olCover(doc: OpenLibraryDoc | undefined): string | undefined {
  return doc?.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined
}

// Finds the real catalog record for a book the AI named, with reader ratings
// combined from Google Books and Open Library. Answers { book: null } when
// nothing matches closely enough, and a 502 when no catalog could be reached.
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

  const google = (async (): Promise<BookRecord[] | null> => {
    try {
      const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 6_000)
      if (!response.ok) return null
      const volumes = ((await response.json()) as { items?: GoogleVolume[] }).items ?? []
      return volumes.flatMap((volume) => {
        const record = toRecord(volume)
        return record ? [record] : []
      })
    } catch {
      return null
    }
  })()
  const [records, openLibrary] = await Promise.all([google, openLibraryMatch(title, author)])

  const picked = records ? pickBook(records, title, author) : null
  const ratings: RatingSource[] = []
  if (picked?.rating && picked.ratingsCount) {
    ratings.push({ source: 'Google Books', average: picked.rating, count: picked.ratingsCount })
  }
  if (openLibrary?.rating) ratings.push(openLibrary.rating)

  if (picked) {
    return json({
      ok: true,
      book: resolvedFromRecord({ ...picked, ratings, coverUrl: picked.coverUrl ?? olCover(openLibrary?.doc) }, note),
    })
  }
  // Google Books had no match (or was down) but Open Library knows the book.
  if (openLibrary?.doc.title) {
    const record: BookRecord = {
      title: openLibrary.doc.title,
      authors: openLibrary.doc.author_name ?? [],
      year: openLibrary.doc.first_publish_year,
      coverUrl: olCover(openLibrary.doc),
      ratings,
    }
    return json({ ok: true, book: { ...resolvedFromRecord(record, note), buy: buyLinks(record) } })
  }
  if (records === null) return json({ ok: false, error: 'Book lookup is unavailable right now.' }, 502)
  return json({ ok: true, book: null })
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

// Reads a Standard Ebooks OPDS feed (Workers have no XML parser, so the few fields needed are pulled out directly).
export function parseStandardEbooks(xml: string): SearchResult[] {
  const unescape = (value: string) =>
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
  const tag = (block: string, name: string) =>
    unescape(block.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1]?.trim() ?? '')
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 8).flatMap((match): SearchResult[] => {
    const block = match[1]
    const title = tag(block, 'title')
    const sourceUrl = tag(block, 'id')
    const epub = [...block.matchAll(/<link\s+([^>]*)\/?>/g)]
      .map((link) => link[1])
      .find((attributes) => /application\/epub\+zip/.test(attributes) && /compatible epub/i.test(attributes))
    const href = epub?.match(/href="([^"]+)"/)?.[1]
    if (!title || !sourceUrl || !href) return []
    const cover = block.match(/<link\s+href="([^"]+)"\s+rel="http:\/\/opds-spec\.org\/image\/thumbnail"/)?.[1]
    const year = Number.parseInt(tag(block, 'published').slice(0, 4), 10)
    return [
      {
        id: sourceUrl,
        title,
        author: tag(block.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? '', 'name') || 'Unknown author',
        year: Number.isFinite(year) ? year : undefined,
        coverUrl: cover,
        description: tag(block, 'summary').slice(0, 400) || undefined,
        source: 'Standard Ebooks',
        sourceUrl,
        // The address as the feed gives it: without its ?source=feed tail Standard Ebooks answers with a web page.
        downloadUrl: unescape(href),
        free: true,
        format: 'EPUB',
        kind: 'book',
      },
    ]
  })
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
    // Standard Ebooks: public-domain classics, carefully made, with no DRM.
    const standard = fetchWithTimeout(`https://standardebooks.org/feeds/opds/all?query=${encoded}`, {
      headers: { accept: 'application/atom+xml' },
    })
      .then(async (response) => (response.ok ? parseStandardEbooks(await response.text()) : []))
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
    const [library, gutenbergResults, academicResults, academicFallbackResults, archiveResults, standardResults] =
      await Promise.all([openLibrary, gutenberg, academic, academicFallback, archive, standard])
    const academicResultsToUse = academicResults.length > 0 ? academicResults : academicFallbackResults
    return json({
      ok: true,
      results: [...standardResults, ...gutenbergResults, ...academicResultsToUse, ...archiveResults, ...library],
    })
  } catch {
    return json({ ok: false, error: 'Free-resource search is temporarily unavailable.' }, 502)
  }
}

const RESOURCE_HOSTS = [
  'standardebooks.org',
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

// ---- Cover search --------------------------------------------------------------------------------
// Looks for cover pictures for a book in Open Library and Google Books, and hands the chosen picture
// to the page from this same address (so it can be saved without the other sites' permission).

const COVER_HOSTS = [
  'covers.openlibrary.org',
  'archive.org',
  'books.google.com',
  'books.googleusercontent.com',
  'googleusercontent.com',
]
const MAX_COVER_BYTES = 3_000_000
const MAX_COVER_REDIRECTS = 4

export function isAllowedCover(url: URL): boolean {
  return (
    url.protocol === 'https:' && COVER_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  )
}

type CoverChoice = { id: string; source: string; label: string; thumb: string; full: string }

async function searchCovers(request: Request, env: Env): Promise<Response> {
  if (rateLimited(request, 'covers', 30))
    return json({ ok: false, error: 'Too many searches. Try again in a minute.' }, 429)
  const params = new URL(request.url).searchParams
  const title = (params.get('title') ?? '').trim().slice(0, MAX_SEARCH_LENGTH)
  const author = (params.get('author') ?? '').trim().slice(0, MAX_SEARCH_LENGTH)
  if (!title) return json({ ok: false, error: 'A title is required.' }, 400)

  const choices: CoverChoice[] = []
  const seen = new Set<string>()
  const add = (choice: CoverChoice) => {
    if (seen.has(choice.full) || choices.length >= 24) return
    seen.add(choice.full)
    choices.push(choice)
  }

  const open = async () => {
    const query = new URLSearchParams({ title, limit: '12', fields: 'cover_i,title,author_name,first_publish_year' })
    if (author && author.toLowerCase() !== 'unknown author') query.set('author', author)
    const response = await fetchWithTimeout(`https://openlibrary.org/search.json?${query}`, {}, 6_000)
    if (!response.ok) return
    const body = (await response.json()) as {
      docs?: Array<{ cover_i?: number; title?: string; author_name?: string[]; first_publish_year?: number }>
    }
    for (const doc of body.docs ?? []) {
      if (!doc.cover_i) continue
      add({
        id: `ol-${doc.cover_i}`,
        source: 'Open Library',
        label: [doc.title, doc.first_publish_year].filter(Boolean).join(' · '),
        thumb: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
        full: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
      })
    }
  }

  const google = async () => {
    const key = env.GOOGLE_BOOKS_API_KEY?.trim()
    const q = `intitle:${title}${author && author.toLowerCase() !== 'unknown author' ? `+inauthor:${author}` : ''}`
    const fields = 'items(id,volumeInfo(title,publishedDate,imageLinks))'
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books&fields=${encodeURIComponent(fields)}${key ? `&key=${encodeURIComponent(key)}` : ''}`,
      {},
      6_000,
    )
    if (!response.ok) return
    const body = (await response.json()) as {
      items?: Array<{
        id?: string
        volumeInfo?: { title?: string; publishedDate?: string; imageLinks?: Record<string, string | undefined> }
      }>
    }
    for (const item of body.items ?? []) {
      const links = item.volumeInfo?.imageLinks
      const small = links?.thumbnail ?? links?.smallThumbnail
      if (!small || !item.id) continue
      const tidy = (value: string) => value.replace(/^http:/, 'https:').replace('&edge=curl', '')
      const thumb = tidy(small)
      const big = links?.extraLarge ?? links?.large ?? links?.medium
      add({
        id: `gb-${item.id}`,
        source: 'Google Books',
        label: [item.volumeInfo?.title, item.volumeInfo?.publishedDate?.slice(0, 4)].filter(Boolean).join(' · '),
        thumb,
        full: big ? tidy(big) : thumb.replace(/zoom=\d/, 'zoom=2'),
      })
    }
  }

  await Promise.allSettled([open(), google()])
  return json({ ok: true, covers: choices })
}

async function proxyCover(request: Request): Promise<Response> {
  if (rateLimited(request, 'cover', 120))
    return json({ ok: false, error: 'Too many pictures. Try again in a minute.' }, 429)
  const target = new URL(request.url).searchParams.get('url')
  let url: URL
  try {
    url = new URL(target ?? '')
  } catch {
    return json({ ok: false, error: 'The picture address is invalid.' }, 400)
  }
  if (!isAllowedCover(url)) return json({ ok: false, error: 'That picture cannot be used.' }, 403)
  let response: Response
  try {
    for (let hop = 0; ; hop += 1) {
      response = await fetchWithTimeout(url, { headers: { accept: 'image/*' }, redirect: 'manual' }, 10_000)
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) break
      if (hop >= MAX_COVER_REDIRECTS) return json({ ok: false, error: 'The picture moved too many times.' }, 502)
      url = new URL(location, url)
      if (!isAllowedCover(url)) return json({ ok: false, error: 'That picture cannot be used.' }, 403)
    }
  } catch {
    return json({ ok: false, error: 'The picture did not load in time.' }, 502)
  }
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.startsWith('image/')) return json({ ok: false, error: 'No picture there.' }, 502)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > MAX_COVER_BYTES) return json({ ok: false, error: 'That picture is too large.' }, 413)
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' },
  })
}

// Fetches a public OPDS catalog for the browser, which often cannot read other sites directly.
// Only public https addresses, only catalog-like answers, and a size limit.
async function proxyCatalogue(request: Request): Promise<Response> {
  if (rateLimited(request, 'opds', 40))
    return json({ ok: false, error: 'Too many requests. Try again in a minute.' }, 429)
  const target = new URL(request.url).searchParams.get('url') ?? ''
  if (!isPublicHttps(target)) return json({ ok: false, error: 'Use the public https address of the catalog.' }, 400)
  let url = new URL(target)
  let response: Response
  try {
    for (let hop = 0; ; hop += 1) {
      response = await fetchWithTimeout(
        url,
        {
          headers: { accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.5', 'user-agent': 'Noesis/1.0' },
          redirect: 'manual',
        },
        15_000,
      )
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) break
      if (hop >= MAX_RESOURCE_REDIRECTS)
        return json({ ok: false, error: 'The catalog redirected too many times.' }, 502)
      url = new URL(location, url)
      if (!isPublicHttps(url.toString()))
        return json({ ok: false, error: 'The catalog redirected somewhere unsafe.' }, 400)
    }
  } catch {
    return json({ ok: false, error: 'The catalog did not respond in time.' }, 502)
  }
  if (!response.ok) return json({ ok: false, error: `The catalog returned ${response.status}.` }, 502)
  const type = response.headers.get('content-type') ?? ''
  if (!/xml|atom|opds/i.test(type)) return json({ ok: false, error: 'That address is not an OPDS catalog.' }, 422)
  const text = await response.text()
  if (text.length > 4_000_000) return json({ ok: false, error: 'That catalog page is too large.' }, 413)
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'private, max-age=60' },
  })
}

// Lets the browser list a public WebDAV folder, or fetch one book from it, with the reader's own login.
// The login is used for this one request and is not stored or logged.
async function proxyWebdav(request: Request): Promise<Response> {
  if (rateLimited(request, 'webdav', 60))
    return json({ ok: false, error: 'Too many requests. Try again in a minute.' }, 429)
  let body: { url?: string; op?: string; user?: string; pass?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ ok: false, error: 'Send a JSON body.' }, 400)
  }
  const target = body.url ?? ''
  if (!isPublicHttps(target)) return json({ ok: false, error: 'Use the public https address of the folder.' }, 400)
  const headers: Record<string, string> = { 'user-agent': 'Noesis/1.0' }
  if (body.user)
    headers.authorization = `Basic ${btoa(unescape(encodeURIComponent(`${body.user}:${body.pass ?? ''}`)))}`
  const listing = body.op !== 'get'
  if (listing) {
    headers.depth = '1'
    headers['content-type'] = 'application/xml'
  }
  let response: Response
  try {
    response = await fetchWithTimeout(
      target,
      {
        method: listing ? 'PROPFIND' : 'GET',
        headers,
        body: listing
          ? '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'
          : undefined,
        redirect: 'manual',
      },
      listing ? 15_000 : 60_000,
    )
  } catch {
    return json({ ok: false, error: 'The server did not respond in time.' }, 502)
  }
  if (response.status === 401 || response.status === 403)
    return json({ ok: false, error: 'The server did not accept that username and password.' }, 401)
  if (response.status >= 300 && response.status < 400)
    return json({ ok: false, error: 'The server redirected. Use its final address.' }, 502)
  if (!response.ok) return json({ ok: false, error: `The server returned ${response.status}.` }, 502)
  if (listing) {
    const text = await response.text()
    if (text.length > 3_000_000) return json({ ok: false, error: 'That folder is too large to list.' }, 413)
    return new Response(text, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } })
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESOURCE_BYTES)
    return json({ ok: false, error: 'That file is too large.' }, 413)
  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    },
  })
}

// ---------- Public libraries (Libby) ----------

export type LibrarySystem = {
  key: string // OverDrive's id, for e-books and audiobooks in Libby
  libbyKey: string // the short name Libby's links use
  name: string
  place: string
  miles?: number
  website?: string
  catalog?: string // the BiblioCommons id, when the library's catalog is there, for books on the shelf
}

function milesBetween(a: [number, number], b: [number, number]): number {
  const rad = (value: number) => (value * Math.PI) / 180
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

type LocateBranch = {
  city?: string
  region?: string
  regionCode?: string
  latitude?: number
  longitude?: number
  systems?: Array<{
    name?: string
    fulfillmentId?: string
    type?: string
    links?: Array<{ name?: string; url?: string }>
  }>
}

// Many public libraries keep their catalog on BiblioCommons, under one of the library's short names.
async function biblioCommonsId(candidates: string[]): Promise<string | undefined> {
  for (const id of [...new Set(candidates.filter((item) => /^[a-z0-9-]{2,40}$/.test(item)))]) {
    try {
      const response = await fetchWithTimeout(
        `https://gateway.bibliocommons.com/v2/libraries/${id}/bibs/search?query=library&searchType=smart&limit=1`,
        { headers: { accept: 'application/json' } },
        4_000,
      )
      void response.body?.cancel()
      if (response.ok) return id
    } catch {
      // Try the next name.
    }
  }
  return undefined
}

// Library systems near a place the reader typed (a city or ZIP code), or near where they are: their
// position is turned into a postal code first and is not kept.
const NEARBY_MILES = 50

export async function findLibraries(request: Request): Promise<Response> {
  if (rateLimited(request, 'libraries', 20))
    return json({ ok: false, error: 'Too many searches. Try again in a minute.' }, 429)
  const params = new URL(request.url).searchParams
  let place = (params.get('q') ?? '').trim().slice(0, 80)
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  const here: [number, number] | null =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && params.has('lat')
      ? [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100]
      : null
  try {
    if (!place && here) {
      const reverse = await fetchWithTimeout(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${here[0]}&longitude=${here[1]}&localityLanguage=en`,
        { headers: { accept: 'application/json' } },
        5_000,
      )
      if (reverse.ok) {
        const body = (await reverse.json()) as { postcode?: string; city?: string; locality?: string }
        place = (body.postcode || body.city || body.locality || '').trim()
      }
    }
    if (place.length < 2) return json({ ok: false, error: 'Enter a city or ZIP code.' }, 400)
    const response = await fetchWithTimeout(
      `https://locate.libbyapp.com/autocomplete/${encodeURIComponent(place)}`,
      { headers: { accept: 'application/json' } },
      6_000,
    )
    if (!response.ok) return json({ ok: false, error: 'Libraries could not be looked up right now.' }, 502)
    const body = (await response.json()) as { branches?: LocateBranch[] }
    const seen = new Map<string, LibrarySystem>()
    // Only libraries that serve the place: a branch within about 50 miles of the reader, or of the best match
    // for what they typed.
    const located = (body.branches ?? []).filter(
      (branch) => typeof branch.latitude === 'number' && typeof branch.longitude === 'number',
    )
    const anchor: [number, number] | null =
      here ?? (located[0] ? [located[0].latitude as number, located[0].longitude as number] : null)
    for (const branch of located) {
      const away = anchor ? milesBetween(anchor, [branch.latitude as number, branch.longitude as number]) : 0
      if (away > NEARBY_MILES) continue
      for (const system of branch.systems ?? []) {
        if (!system.fulfillmentId || !system.name || (system.type && system.type !== 'Public Library')) continue
        const site = system.links?.find((link) => link.name === 'MainLibraryUrl')?.url?.trim()
        const website = site
          ? (/^https?:\/\//i.test(site) ? site : `https://${site}`).replace(/^http:/i, 'https:')
          : undefined
        const miles =
          here && typeof branch.latitude === 'number' && typeof branch.longitude === 'number'
            ? Math.round(milesBetween(here, [branch.latitude, branch.longitude]))
            : undefined
        const known = seen.get(system.fulfillmentId)
        if (known && (known.miles === undefined || miles === undefined || known.miles <= miles)) continue
        seen.set(system.fulfillmentId, {
          key: system.fulfillmentId,
          libbyKey: system.fulfillmentId,
          name: system.name.slice(0, 100),
          place: [branch.city, branch.regionCode || branch.region].filter(Boolean).join(', '),
          miles,
          website: website && isPublicHttps(website) ? website : undefined,
        })
      }
    }
    const systems = [...seen.values()].sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0)).slice(0, 8)
    // Libby's own links use the library's short name; the shelf catalog is looked for under the same names.
    await Promise.all(
      systems.map(async (system) => {
        try {
          const info = await fetchWithTimeout(
            `https://thunder.api.overdrive.com/v2/libraries/${encodeURIComponent(system.key)}`,
            { headers: { accept: 'application/json' } },
            4_000,
          )
          if (info.ok) {
            const detail = (await info.json()) as { preferredKey?: string }
            if (detail.preferredKey && /^[\w-]{1,40}$/.test(detail.preferredKey)) system.libbyKey = detail.preferredKey
          }
        } catch {
          // The longer key still works in Libby's search.
        }
        try {
          const host = system.website ? new URL(system.website).hostname.replace(/^www\./, '').split('.')[0] : ''
          system.catalog = await biblioCommonsId([system.libbyKey, system.key, host].map((item) => item.toLowerCase()))
        } catch {
          // No shelf catalog found; the library's website is offered instead.
        }
      }),
    )
    return json({ ok: true, place, systems })
  } catch {
    return json({ ok: false, error: 'Libraries could not be looked up right now.' }, 502)
  }
}

// A printed copy in the library's BiblioCommons catalog, and how many are in.
async function onTheShelf(catalog: string, query: string, title: string, author: string): Promise<LibraryCopy | null> {
  try {
    const response = await fetchWithTimeout(
      `https://gateway.bibliocommons.com/v2/libraries/${catalog}/bibs/search?query=${encodeURIComponent(query)}&searchType=smart&limit=10`,
      { headers: { accept: 'application/json' } },
      6_000,
    )
    if (!response.ok) return null
    const body = (await response.json()) as {
      entities?: {
        bibs?: Record<
          string,
          {
            briefInfo?: { title?: string; authors?: string[]; format?: string }
            availability?: { bibType?: string; availableCopies?: number; totalCopies?: number; heldCopies?: number }
          }
        >
      }
    }
    const wanted = sameWords(title)
    const surname =
      sameWords(author.split(',')[0] ?? '')
        .split(' ')
        .pop() ?? ''
    for (const [id, bib] of Object.entries(body.entities?.bibs ?? {})) {
      const info = bib.briefInfo
      if (!info?.title || sameWords(info.title) !== wanted) continue
      if (!['BK', 'LPRINT', 'PAPERBACK'].includes(info.format ?? '') || bib.availability?.bibType !== 'PHYSICAL')
        continue
      if (surname && !(info.authors ?? []).some((name) => sameWords(name).includes(surname))) continue
      const copies = bib.availability?.totalCopies ?? 0
      if (copies < 1) continue
      const available = bib.availability?.availableCopies ?? 0
      return {
        format: 'print',
        available: available > 0,
        copies,
        held: bib.availability?.heldCopies,
        url: `https://${catalog}.bibliocommons.com/v2/record/${encodeURIComponent(id)}`,
      }
    }
    return null
  } catch {
    return null
  }
}

const sameWords = (value: string) =>
  value
    .toLowerCase()
    .split(':')[0]
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export type LibraryCopy = {
  format: 'ebook' | 'audiobook' | 'print'
  held?: number
  available: boolean
  copies?: number
  waitDays?: number
  url: string
}

// Whether the reader's library has a book in Libby, as an e-book or audiobook, and if it is free now.
export async function libraryHas(request: Request): Promise<Response> {
  if (rateLimited(request, 'library-has', 60))
    return json({ ok: false, error: 'Too many lookups. Try again in a minute.' }, 429)
  const params = new URL(request.url).searchParams
  const key = (params.get('library') ?? '').trim()
  const libbyKey = (params.get('libby') ?? key).trim()
  const catalog = (params.get('catalog') ?? '').trim()
  const title = (params.get('title') ?? '').trim().slice(0, 160)
  const author = (params.get('author') ?? '').trim().slice(0, 100)
  if (!/^[\w-]{1,60}$/.test(key) || !/^[\w-]{1,60}$/.test(libbyKey) || title.length < 2)
    return json({ ok: false, error: 'Choose a library and a book.' }, 400)
  try {
    const query = `${title} ${author.split(',')[0] ?? ''}`.trim()
    const shelf = /^[a-z0-9-]{2,40}$/.test(catalog) ? onTheShelf(catalog, query, title, author) : Promise.resolve(null)
    const response = await fetchWithTimeout(
      `https://thunder.api.overdrive.com/v2/libraries/${encodeURIComponent(key)}/media?query=${encodeURIComponent(query)}&perPage=12`,
      { headers: { accept: 'application/json' } },
      6_000,
    )
    if (!response.ok) return json({ ok: false, error: 'Your library could not be checked right now.' }, 502)
    const body = (await response.json()) as {
      items?: Array<{
        id?: string
        title?: string
        firstCreatorName?: string
        type?: { id?: string }
        isAvailable?: boolean
        ownedCopies?: number
        estimatedWaitDays?: number
      }>
    }
    const wanted = sameWords(title)
    const surname =
      sameWords(author.split(',')[0] ?? '')
        .split(' ')
        .pop() ?? ''
    const copies: LibraryCopy[] = []
    for (const item of body.items ?? []) {
      const format = item.type?.id === 'audiobook' ? 'audiobook' : item.type?.id === 'ebook' ? 'ebook' : null
      if (!format || !item.id || !item.title || sameWords(item.title) !== wanted) continue
      if (surname && !sameWords(item.firstCreatorName ?? '').includes(surname)) continue
      if (copies.some((copy) => copy.format === format)) continue
      copies.push({
        format,
        available: Boolean(item.isAvailable),
        copies: item.ownedCopies,
        waitDays: item.isAvailable ? undefined : item.estimatedWaitDays,
        url: `https://share.libbyapp.com/title/${encodeURIComponent(item.id)}`,
      })
    }
    const print = await shelf
    if (print) copies.unshift(print)
    return json({
      ok: true,
      copies,
      searchUrl: `https://libbyapp.com/search/${libbyKey}/search/query-${encodeURIComponent(query)}/page-1`,
    })
  } catch {
    return json({ ok: false, error: 'Your library could not be checked right now.' }, 502)
  }
}

// ---------- Subjects: a map of questions around the reading ----------

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}
const textOf = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

// A new subject: four to seven areas from the usual start onward, each with a few open questions.
async function startSubject(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'subject',
    6,
    'Too many requests. Try again in a few minutes.',
    'Sign in to start a subject.',
  )
  if (refused) return refused
  const input = await readJson<{ goal?: unknown; focus?: unknown; level?: unknown }>(request)
  if (!input) return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  const goal = textOf(input.goal, 400)
  if (goal.length < 3) return json({ ok: false, error: 'Tell Noema what you are curious about.' }, 400)
  const focus = textOf(input.focus, 80)
  const level = textOf(input.level, 40)
  const result = await generate(env, {
    system: [
      'You help a reader explore a subject they are curious about, alongside the books they read. This is not a course: no lessons, tests, or schedules.',
      'Reply with JSON only, in exactly this shape: {"title":"","summary":"","areas":[{"title":"","blurb":"","questions":[{"text":"","hook":""}]}]}.',
      '"title" names the subject in two to five words. "summary" is one plain sentence on what exploring it covers.',
      'Give four to six "areas", ordered from where most people start to more specialized ground. "title" is two to four words; "blurb" is one short sentence.',
      'Each area has three or four "questions": real questions a curious person would ask, specific and answerable by reading, in plain words, most concrete first. Mix practical questions (how do I…, why does…) with ones about how it works.',
      '"hook" is one short line (at most 14 words) on what makes the question interesting: a surprise, a common mistake, or what knowing it lets you do. No exclamation marks.',
      level ? `The reader describes their level as: ${level}.` : '',
      'Use American English.',
    ]
      .filter(Boolean)
      .join(' '),
    prompt: `What the reader is curious about: ${goal}${focus ? `\nFocus: ${focus}` : ''}`,
    maxOutputTokens: 5_000,
    temperature: 0.5,
    json: true,
    timeoutMs: 45_000,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)
  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
  }
  const draft = cleanSubjectReply(parsed)
  if (!draft) return json({ ok: false, error: 'Noema could not map that subject. Try saying it differently.' }, 502)
  return json({ ok: true, draft })
}

type CheckedPick = {
  type: PickType
  title: string
  source: string
  url?: string
  minutes?: number
  why?: string
  thumb?: string
  author?: string
}

// A link Noema named is kept only when the page answers; a YouTube link only when YouTube knows the video,
// and then with its real title and channel.
async function checkVideo(draft: PickDraft): Promise<CheckedPick | null> {
  if (!draft.url || !youtubeId(draft.url)) return null
  try {
    const response = await fetchWithTimeout(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(draft.url)}`,
      { headers: { accept: 'application/json' } },
      4_000,
    )
    if (!response.ok) return null
    const body = (await response.json()) as { title?: string; author_name?: string; thumbnail_url?: string }
    if (!body.title) return null
    return {
      type: 'watch',
      title: body.title.slice(0, 140),
      source: body.author_name?.slice(0, 80) || 'YouTube',
      url: draft.url,
      minutes: draft.minutes,
      why: draft.why,
      thumb: body.thumbnail_url,
    }
  } catch {
    return null
  }
}

// With a YouTube key, videos are found by search (real results only), with their lengths.
export async function searchVideos(words: string, why: string | undefined, key: string): Promise<CheckedPick[]> {
  try {
    const search = await fetchWithTimeout(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&relevanceLanguage=en&maxResults=4&q=${encodeURIComponent(words)}&key=${encodeURIComponent(key)}`,
      { headers: { accept: 'application/json' } },
      5_000,
    )
    if (!search.ok) return []
    const found = (await search.json()) as {
      items?: Array<{
        id?: { videoId?: string }
        snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } }
      }>
    }
    const items = (found.items ?? []).filter((item) => item.id?.videoId && item.snippet?.title)
    if (!items.length) return []
    const ids = items.map((item) => item.id!.videoId!).join(',')
    const details = await fetchWithTimeout(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${encodeURIComponent(key)}`,
      { headers: { accept: 'application/json' } },
      5_000,
    )
    const lengths = new Map<string, number | undefined>()
    if (details.ok) {
      const body = (await details.json()) as { items?: Array<{ id?: string; contentDetails?: { duration?: string } }> }
      for (const item of body.items ?? [])
        if (item.id) lengths.set(item.id, isoMinutes(item.contentDetails?.duration ?? ''))
    }
    return items.slice(0, 3).map((item) => ({
      type: 'watch' as const,
      title: decodeEntities(item.snippet!.title!).slice(0, 140),
      source: decodeEntities(item.snippet?.channelTitle ?? 'YouTube').slice(0, 80),
      url: `https://www.youtube.com/watch?v=${item.id!.videoId!}`,
      minutes: lengths.get(item.id!.videoId!),
      why,
      thumb: item.snippet?.thumbnails?.medium?.url,
    }))
  } catch {
    return []
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// Podcast episodes through Apple's open podcast search (no key): only episodes that exist are kept.
export async function searchEpisodes(words: string, why: string | undefined): Promise<CheckedPick[]> {
  try {
    const response = await fetchWithTimeout(
      `https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=4&term=${encodeURIComponent(words)}`,
      { headers: { accept: 'application/json' } },
      5_000,
    )
    if (!response.ok) return []
    const body = (await response.json()) as {
      results?: Array<{
        trackName?: string
        collectionName?: string
        trackViewUrl?: string
        trackTimeMillis?: number
        artworkUrl160?: string
        artworkUrl600?: string
      }>
    }
    return (body.results ?? [])
      .filter((item) => item.trackName && item.trackViewUrl && isPublicHttps(item.trackViewUrl))
      .slice(0, 2)
      .map((item) => ({
        type: 'listen' as const,
        title: item.trackName!.slice(0, 140),
        source: item.collectionName?.slice(0, 80) || 'Podcast',
        url: item.trackViewUrl!,
        minutes: item.trackTimeMillis ? Math.max(1, Math.round(item.trackTimeMillis / 60_000)) : undefined,
        why,
        thumb: item.artworkUrl160 ?? item.artworkUrl600,
      }))
  } catch {
    return []
  }
}

// One Wikipedia article by its exact title, when it exists and is not a list of meanings.
// Wikipedia articles found by Wikipedia's own search (they exist), with a line from the article as the reason.
export async function wikipediaSearch(words: string, limit = 3): Promise<CheckedPick[]> {
  try {
    const response = await fetchWithTimeout(
      `https://en.wikipedia.org/w/rest.php/v1/search/page?limit=${limit}&q=${encodeURIComponent(words.slice(0, 200))}`,
      { headers: { accept: 'application/json', 'user-agent': WIKI_AGENT } },
      4_000,
    )
    if (!response.ok) return []
    const body = (await response.json()) as { pages?: Array<{ key?: string; title?: string; description?: string }> }
    return (body.pages ?? [])
      .filter((page) => page.key && page.title)
      .map((page) => ({
        type: 'read' as const,
        title: page.title!.slice(0, 140),
        source: 'Wikipedia',
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key!)}`,
        why: page.description ? page.description.slice(0, 140) : undefined,
      }))
  } catch {
    return []
  }
}

export async function wikipediaPick(title: string, why: string | undefined): Promise<CheckedPick | null> {
  try {
    const response = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      { headers: { accept: 'application/json', 'user-agent': WIKI_AGENT } },
      4_000,
    )
    if (!response.ok) return null
    const body = (await response.json()) as {
      type?: string
      title?: string
      content_urls?: { desktop?: { page?: string } }
      thumbnail?: { source?: string }
    }
    const url = body.content_urls?.desktop?.page
    if (body.type !== 'standard' || !body.title || !url) return null
    return { type: 'read', title: body.title, source: 'Wikipedia', url, why }
  } catch {
    return null
  }
}

// What to explore for one question: Noema names books, articles, videos and episodes; every link is checked or
// found by a real search, and anything that cannot be confirmed is left out. Books come back as names for the
// app to look up (with covers and where to get them).
async function exploreQuestion(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'question',
    15,
    'Too many requests. Try again in a minute.',
    'Sign in to explore questions.',
  )
  if (refused) return refused
  const input = await readJson<{
    subject?: unknown
    area?: unknown
    question?: unknown
    level?: unknown
    reading?: unknown
  }>(request)
  if (!input) return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  const subject = textOf(input.subject, 100)
  const area = textOf(input.area, 80)
  const question = textOf(input.question, 200)
  const level = textOf(input.level, 40)
  const reading = (Array.isArray(input.reading) ? input.reading : [])
    .map((item) => textOf(item, 140))
    .filter(Boolean)
    .slice(0, 8)
  if (!subject || question.length < 3) return json({ ok: false, error: 'Choose a question to explore.' }, 400)
  const result = await generate(env, {
    system: [
      'You suggest what to read, watch, or listen to for one question, for someone exploring a subject in a reading app. Books come first; the rest goes with the reading.',
      'Reply with JSON only, in exactly this shape:',
      '{"hook":"","short":"","followUp":"","wiki":"","books":[{"title":"","author":"","why":""}],"read":[{"title":"","source":"","url":"","minutes":0,"why":""}],"watch":[{"title":"","source":"","url":"","search":"","minutes":0,"why":""}],"listen":[{"search":"","why":""}],"try":[{"title":"","source":"","url":"","why":""}],"useIt":""}.',
      '"hook" is one line on what makes the question interesting. "short" answers it plainly in three or four sentences. "followUp" is one question the answer naturally leads to.',
      '"useIt" is one small, concrete thing the reader could do in the next few days to use the answer, under 15 words, starting with a verb (for example "Squeeze a handful of your soil and see if it holds together"); give it only when the subject is practical (a skill, craft, garden, kitchen, body, money, tools), otherwise "".',
      '"wiki" is the exact title of the English Wikipedia article that best covers it, or "" if none fits.',
      '"books": two to four real, published books you are confident exist that answer it well, with the author, best first. "read": three or four free articles or guides from reputable sites (universities, public bodies, well-known publications, extension services); give an exact address only when you are sure of it, and "minutes" as reading time.',
      '"watch": two or three YouTube videos (talks, lectures, explainers, demonstrations), from well-known channels where you can; give "url" only if you are certain of the exact video address, and always give "search", the words to find a good video on it. "listen": one or two podcast search phrases for episodes on it. "try": at most one hands-on thing (a tool, calculator, field guide, or exercise) only if the subject is practical; otherwise [].',
      '"why" is a short line on what this pick adds for the question, never generic praise.',
      reading.length ? `The reader already has these books: ${reading.join('; ')}. Do not suggest them again.` : '',
      level ? `The reader describes their level as: ${level}.` : '',
      'Never invent a book, author, or web address. Use American English.',
    ]
      .filter(Boolean)
      .join(' '),
    prompt: `Subject: ${subject}${area ? `\nArea: ${area}` : ''}\nQuestion: ${question}`,
    maxOutputTokens: 3_500,
    temperature: 0.4,
    json: true,
    timeoutMs: 40_000,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result.text) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
  }
  const draft = cleanQuestionReply(parsed)
  const wiki = textOf(parsed.wiki, 120)
  const books = draft.picks
    .filter((pick) => pick.type === 'book')
    .slice(0, 4)
    .map((pick) => ({ title: pick.title, author: pick.author || pick.source, note: pick.why }))
  const links = draft.picks.filter((pick) => (pick.type === 'read' || pick.type === 'try') && pick.url)
  const videos = draft.picks.filter((pick) => pick.type === 'watch')
  const listens = draft.picks.filter((pick) => pick.type === 'listen').slice(0, 2)
  const youtubeKey = env.YOUTUBE_API_KEY?.trim()
  const videoWords = videos.find((pick) => pick.search)?.search ?? `${question} ${subject}`
  const [checkedLinks, wikiPick, foundVideos, checkedVideos, episodeLists, related] = await Promise.all([
    Promise.all(links.map(async (pick) => ((await linkWorks(pick.url!)) ? pick : null))),
    wiki ? wikipediaPick(wiki, undefined) : Promise.resolve(null),
    youtubeKey ? searchVideos(videoWords, videos[0]?.why, youtubeKey) : Promise.resolve([] as CheckedPick[]),
    youtubeKey ? Promise.resolve([] as Array<CheckedPick | null>) : Promise.all(videos.slice(0, 3).map(checkVideo)),
    Promise.all(listens.map((pick) => searchEpisodes(pick.search || pick.title, pick.why))),
    wikipediaSearch(`${question} ${subject}`),
  ])
  const episodes = episodeLists.flat()
  const kept: CheckedPick[] = []
  const read = checkedLinks.filter((pick): pick is PickDraft => Boolean(pick && pick.type === 'read')).slice(0, 4)
  if (wikiPick && !read.some((pick) => pick.url === wikiPick.url)) kept.push(wikiPick)
  for (const pick of read)
    kept.push({
      type: 'read',
      title: pick.title,
      source: pick.source,
      url: pick.url,
      minutes: pick.minutes,
      why: pick.why,
    })
  // Wikipedia's own search fills Read up to four with articles that exist, when Noema's links fell short.
  for (const pick of related) {
    if (kept.filter((item) => item.type === 'read').length >= 4) break
    if (!kept.some((item) => item.url === pick.url)) kept.push(pick)
  }
  kept.push(...foundVideos, ...checkedVideos.filter((pick): pick is CheckedPick => Boolean(pick)))
  const seenEpisodes = new Set<string>()
  kept.push(
    ...episodes.filter((pick) => pick.url && !seenEpisodes.has(pick.url) && seenEpisodes.add(pick.url)).slice(0, 3),
  )
  const tried = checkedLinks.find((pick) => pick?.type === 'try')
  if (tried) kept.push({ type: 'try', title: tried.title, source: tried.source, url: tried.url, why: tried.why })
  return json({
    ok: true,
    hook: draft.hook,
    short: draft.short,
    followUp: draft.followUp,
    useIt: draft.useIt,
    books,
    picks: kept,
  })
}

// A first draft of an area's summary, from the reader's own answers only. They edit it before it is kept.
async function sumUpArea(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'sumup',
    10,
    'Too many requests. Try again in a minute.',
    'Sign in to use Noema.',
  )
  if (refused) return refused
  const input = await readJson<{ subject?: unknown; area?: unknown; answers?: unknown; questions?: unknown }>(request)
  if (!input) return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  const subject = textOf(input.subject, 100)
  const area = textOf(input.area, 80)
  const answers = (Array.isArray(input.answers) ? input.answers : [])
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      return { question: textOf(row.question, 200), answer: textOf(row.answer, 600) }
    })
    .filter((item) => item.question && item.answer)
    .slice(0, 30)
  const questions = (Array.isArray(input.questions) ? input.questions : [])
    .map((item) => textOf(item, 200))
    .slice(0, 40)
  if (!area || answers.length === 0) return json({ ok: false, error: 'Answer a few questions first.' }, 400)
  const result = await generate(env, {
    system: [
      'Reply with JSON only, in exactly this shape: {"summary":"","merges":[{"a":0,"b":0,"text":""}]}.',
      `"summary": a short summary of what a reader has worked out about one area of a subject, using only the reader's own answers. Three to five plain sentences in the first person ("I"), joining the answers into one picture. Add nothing the answers do not say.`,
      '"merges": pairs from the numbered list of questions that ask essentially the same thing, by their numbers ("a" is kept, "b" is folded into it), with "text" one clear wording that covers both. At most three pairs; [] when none overlap. Never pair questions that only share a topic.',
      'Use American English.',
    ].join(' '),
    prompt: [
      `Subject: ${subject}`,
      `Area: ${area}`,
      answers.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n'),
      questions.length
        ? `Questions in this area:\n${questions.map((text, index) => `${index + 1}. ${text}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    maxOutputTokens: 800,
    temperature: 0.3,
    json: true,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)
  try {
    const parsed = JSON.parse(result.text) as { summary?: unknown; merges?: unknown }
    const text = textOf(parsed.summary, 1_200)
    if (!text) return json({ ok: false, error: 'Noema could not draft a summary right now.' }, 502)
    return json({ ok: true, text, merges: Array.isArray(parsed.merges) ? parsed.merges.slice(0, 3) : [] })
  } catch {
    return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({
        ok: true,
        googleRenews: Boolean(env.GOOGLE_DRIVE_CLIENT_SECRET?.trim()),
        googleDriveClientId: env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() || env.GOOGLE_DRIVE_CLIENT_ID?.trim() || '',
        oneDriveClientId: env.VITE_ONEDRIVE_CLIENT_ID?.trim() || env.ONEDRIVE_CLIENT_ID?.trim() || '',
        dropboxAppKey: env.VITE_DROPBOX_APP_KEY?.trim() || env.DROPBOX_APP_KEY?.trim() || '',
        vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || '',
        passkeys: Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      })
    }
    if (url.pathname === '/api/cloud-token' && request.method === 'POST') {
      const secret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim()
      const clientId = env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() || env.GOOGLE_DRIVE_CLIENT_ID?.trim()
      if (!secret || !clientId) return json({ error: 'Not set up.' }, 503)
      let input: Record<string, unknown>
      try {
        input = (await request.json()) as Record<string, unknown>
      } catch {
        return json({ error: 'Bad request.' }, 400)
      }
      const fields = new URLSearchParams({ client_id: clientId, client_secret: secret })
      if (input.grant_type === 'refresh_token' && typeof input.refresh_token === 'string') {
        fields.set('grant_type', 'refresh_token')
        fields.set('refresh_token', input.refresh_token)
      } else if (
        input.grant_type === 'authorization_code' &&
        typeof input.code === 'string' &&
        typeof input.code_verifier === 'string' &&
        typeof input.redirect_uri === 'string' &&
        input.redirect_uri.startsWith(`${url.origin}/oauth/`)
      ) {
        fields.set('grant_type', 'authorization_code')
        fields.set('code', input.code)
        fields.set('code_verifier', input.code_verifier)
        fields.set('redirect_uri', input.redirect_uri)
      } else {
        return json({ error: 'Bad request.' }, 400)
      }
      try {
        const upstream = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: fields,
        })
        const body = (await upstream.json().catch(() => ({}))) as Record<string, unknown>
        return json(
          upstream.ok
            ? { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in }
            : { error: String(body.error ?? 'Google refused the request.') },
          upstream.ok ? 200 : upstream.status,
        )
      } catch {
        return json({ error: 'Could not reach Google.' }, 502)
      }
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
    if (url.pathname === '/api/libraries' && request.method === 'GET') return findLibraries(request)
    if (url.pathname === '/api/library-has' && request.method === 'GET') return libraryHas(request)
    if (url.pathname === '/api/subject' && request.method === 'POST') return startSubject(request, env)
    if (url.pathname === '/api/question' && request.method === 'POST') return exploreQuestion(request, env)
    if (url.pathname === '/api/sumup' && request.method === 'POST') return sumUpArea(request, env)
    if (url.pathname === '/api/webdav') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return proxyWebdav(request)
    }
    if (url.pathname === '/api/opds') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return proxyCatalogue(request)
    }
    if (url.pathname === '/api/define') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return defineWord(request)
    }
    if (url.pathname === '/api/clarify') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return clarifyGoal(request, env)
    }
    if (url.pathname === '/api/book') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return lookupBook(request, env)
    }
    if (url.pathname.startsWith('/api/passkey/')) {
      if (rateLimited(request, 'passkey', 30)) return json({ error: 'Too many tries. Wait a minute.' }, 429)
      return handlePasskey(request, env, url.pathname.slice('/api/passkey/'.length))
    }
    if (url.pathname === '/api/search' && request.method === 'GET') return searchFreeResources(request)
    if (url.pathname === '/api/resource' && request.method === 'GET') return proxyResource(request)
    if (url.pathname === '/api/covers' && request.method === 'GET') return searchCovers(request, env)
    if (url.pathname === '/api/cover' && request.method === 'GET') return proxyCover(request)
    return env.ASSETS.fetch(request)
  },
  // Every 15 minutes (wrangler.jsonc triggers): review reminders whose time has come.
  async scheduled(_event: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    context.waitUntil(sendReviewReminders(env))
  },
}

export default worker
