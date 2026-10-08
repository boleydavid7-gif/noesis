import {
  BOOK_NOTES,
  RESOURCE_KINDS,
  buyLinks,
  cleanBooks,
  cleanResources,
  isPublicHttps,
  cleanSuggestion,
  MAX_PATHS,
  matchScore,
  pickBook,
  resolvedFromRecord,
  type BookRecord,
  type RatingSource,
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

const RETRY_PAUSE_MS = 1_500
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
  for (let round = 0; round < 2; round += 1) {
    let sawBusy = false
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
          options.timeoutMs ?? 25_000,
        )
      } catch {
        return { ok: false, error: 'Noema could not reach Gemini right now.', status: 502 }
      }

      if (response.ok) {
        const body = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }
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
      'List six to eight "focuses": distinct, specific areas within the subject that someone might want to study, ordered from the usual starting point to more specialised areas. Include a foundational or introductory focus first. "title" is two to five words; "description" is one or two plain sentences saying what studying this area is about; "covers" lists three or four of the main topics someone would study; "fits" is one short sentence on who it suits or what it leads to.',
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

// Finds books and free resources for one stage of a saved path, on request.
async function findMaterials(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'materials',
    12,
    'Too many requests. Try again in a few minutes.',
    'Sign in to find study materials.',
  )
  if (refused) return refused
  let input: { goal?: unknown; stage?: unknown; topics?: unknown; level?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const goal = text(input.goal, 400)
  const stage = text(input.stage, 100)
  const topics = (Array.isArray(input.topics) ? input.topics : [])
    .map((item) => text(item, 100))
    .filter(Boolean)
    .slice(0, 8)
  if (!goal || !stage || topics.length === 0)
    return json({ ok: false, error: 'Tell Noema which stage to find materials for.' }, 400)
  const level = text(input.level, 40)
  const result = await generate(env, {
    system: [
      'You recommend study materials for one stage of a learning path. Reply with JSON only, in exactly this shape:',
      '{"books":[{"title":"","author":"","note":""}],"resources":[{"title":"","publisher":"","url":"","kind":"","note":""}]}.',
      'Give three or four real, published books you are confident exist that teach exactly the topics given, best fit first, with the author\'s name. "note" is one of: ' +
        BOOK_NOTES.join(', ') +
        '.',
      'Give two to four free, reputable resources for those topics, such as official courses, documentation, university open courseware, or well-known video series. "kind" is one of: ' +
        RESOURCE_KINDS.join(', ') +
        '.',
      level ? `Pitch them for a learner who is: ${level}.` : '',
      "Never invent a book, an author, or a web address. If you are not sure of an exact address, use the provider's main website address.",
    ]
      .filter(Boolean)
      .join(' '),
    prompt: `Learner's goal: ${goal}\nStage: ${stage}\nTopics: ${topics.join('; ')}`,
    maxOutputTokens: 2_000,
    temperature: 0.4,
    json: true,
    timeoutMs: 30_000,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)
  let parsed: { books?: unknown; resources?: unknown }
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
  }
  const books = cleanBooks(parsed.books, 5)
  const resources = cleanResources(parsed.resources, 6)
  const checks = await Promise.all(resources.map((resource) => linkWorks(resource.url)))
  const working = resources.filter((_, index) => checks[index])
  if (books.length === 0 && working.length === 0)
    return json({ ok: false, error: 'Noema could not find materials for that stage. Try again.' }, 502)
  return json({ ok: true, books, resources: working })
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

// A one-question check on a topic from a learning path: ask a question, then
// judge the learner's answer. Stateless, so the page sends the question back.
async function quizTopic(request: Request, env: Env): Promise<Response> {
  const refused = await guardAi(
    request,
    env,
    'quiz',
    20,
    'Too many requests. Try again in a minute.',
    'Sign in to be quizzed.',
  )
  if (refused) return refused
  let input: {
    mode?: unknown
    goal?: unknown
    stage?: unknown
    topic?: unknown
    question?: unknown
    answer?: unknown
    level?: unknown
  }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const topic = text(input.topic, 120)
  if (!topic) return json({ ok: false, error: 'Tell Noema which topic to check.' }, 400)
  const context = `Learner's goal: ${text(input.goal, 300)}\nStage: ${text(input.stage, 100)}\nTopic: ${topic}\nLevel: ${text(input.level, 40) || 'Beginner'}`

  if (input.mode === 'grade') {
    const question = text(input.question, 500)
    const answer = text(input.answer, 1_500)
    if (!question || answer.length < 2) return json({ ok: false, error: 'Write an answer first.' }, 400)
    const result = await generate(env, {
      system: [
        'You mark one answer from a learner. Reply with JSON only: {"verdict":"correct"|"partly"|"incorrect","feedback":"","ideal":""}.',
        '"feedback" is one or two plain, encouraging sentences saying what was right and what was missing. "ideal" is a short model answer of one to three sentences.',
        'Judge understanding, not wording. Never invent facts.',
      ].join(' '),
      prompt: `${context}\nQuestion: ${question}\nLearner's answer: ${answer}`,
      maxOutputTokens: 500,
      temperature: 0.2,
      json: true,
    })
    if (!result.ok) return json({ ok: false, error: result.error }, result.status)
    try {
      const parsed = JSON.parse(result.text) as { verdict?: unknown; feedback?: unknown; ideal?: unknown }
      const verdict = parsed.verdict === 'correct' || parsed.verdict === 'partly' ? parsed.verdict : 'incorrect'
      return json({
        ok: true,
        verdict,
        feedback: text(parsed.feedback, 400),
        ideal: text(parsed.ideal, 600),
      })
    } catch {
      return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
    }
  }

  const result = await generate(env, {
    system: [
      'You check whether a learner understands one topic. Reply with JSON only: {"question":""}.',
      "Ask one clear question that tests understanding of the topic rather than recall of a definition. It must be answerable in two or three sentences by someone who has studied the topic at the learner's level.",
    ].join(' '),
    prompt: context,
    maxOutputTokens: 200,
    temperature: 0.7,
    json: true,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, result.status)
  try {
    const question = text((JSON.parse(result.text) as { question?: unknown }).question, 500)
    return question
      ? json({ ok: true, question })
      : json({ ok: false, error: 'Noema could not write a question. Try again.' }, 502)
  } catch {
    return json({ ok: false, error: 'Noema answered in an unexpected format. Try again.' }, 502)
  }
}

// Turns a learner's goal into structured paths, plus books and free
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
  let input: { goal?: unknown; focuses?: unknown; level?: unknown; purpose?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }
  const goal = typeof input.goal === 'string' ? input.goal.trim().slice(0, 400) : ''
  if (goal.length < 8) return json({ ok: false, error: 'Describe what you want to learn in a sentence or two.' }, 400)
  const focuses = (Array.isArray(input.focuses) ? input.focuses : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, MAX_PATHS)
  const level = typeof input.level === 'string' ? input.level.trim().slice(0, 40) : ''
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim().slice(0, 80) : ''
  const count = focuses.length || 3

  const system = [
    'You design learning paths for a reading app. Reply with JSON only, in exactly this shape:',
    '{"paths":[{"title":"","summary":"","level":"","milestones":[{"title":"","outcome":"","hours":0,"topics":[""],"resources":[""],"books":[""]}],"reading":[{"title":"","author":"","note":""}]}],',
    '"resources":[{"title":"","publisher":"","url":"","kind":"","note":""}]}.',
    focuses.length
      ? `Give exactly ${focuses.length} ${focuses.length === 1 ? 'path' : 'paths'}, one for each of these focus areas, using the focus area as the basis of the title: ${focuses.map((item) => `"${item}"`).join(', ')}.`
      : `Give exactly ${count} paths for the learner's goal, each with a different emphasis that fits the goal (for example foundations, career or exam preparation, and hands-on practice).`,
    'Each path has five milestones ordered from basics to advanced, and each milestone has two to four short topics. "level" is Beginner, Intermediate, or Advanced' +
      (level ? `; the learner described their level as "${level}", so pitch every path for that level` : '') +
      '.',
    purpose ? `The learner wants this for: ${purpose}. Let that shape what each path emphasises.` : '',
    'For every milestone give an "outcome", one sentence starting with a verb that says what the learner can do once the milestone is finished; "hours", your honest estimate of the total study hours an average learner needs for the whole milestone (a whole number); and "resources" and "books", each listing one or two items taken from your own lists that best fit that milestone, written with their exact titles. Do not give dates or durations.',
    'Every path has its own "reading" list of six real, published books you are confident exist, specific to that path\'s focus (include the standard foundational textbooks or introductions for that focus, not just general titles), with the author\'s name. "note" is one of: ' +
      BOOK_NOTES.join(', ') +
      '. The "books" in each milestone must use titles from that path\'s own reading list.',
    'List four to six free, reputable resources for the whole goal, such as official courses, documentation, university open courseware, or well-known video series. "kind" is one of: ' +
      RESOURCE_KINDS.join(', ') +
      '.',
    "Never invent a book, an author, or a web address. If you are not sure of an exact address, use the provider's main website address.",
  ]
    .filter(Boolean)
    .join(' ')
  const result = await generate(env, {
    system,
    prompt: `Learner's goal: ${goal}`,
    maxOutputTokens: 2_500 * count + 1_000,
    timeoutMs: 20_000 + 8_000 * count,
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

// Finds the real catalogue record for a book the AI named, with reader ratings
// combined from Google Books and Open Library. Answers { book: null } when
// nothing matches closely enough, and a 502 when no catalogue could be reached.
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

// Fetches a public OPDS catalogue for the browser, which often cannot read other sites directly.
// Only public https addresses, only catalogue-like answers, and a size limit.
async function proxyCatalogue(request: Request): Promise<Response> {
  if (rateLimited(request, 'opds', 40))
    return json({ ok: false, error: 'Too many requests. Try again in a minute.' }, 429)
  const target = new URL(request.url).searchParams.get('url') ?? ''
  if (!isPublicHttps(target)) return json({ ok: false, error: 'Use the public https address of the catalogue.' }, 400)
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
        return json({ ok: false, error: 'The catalogue redirected too many times.' }, 502)
      url = new URL(location, url)
      if (!isPublicHttps(url.toString()))
        return json({ ok: false, error: 'The catalogue redirected somewhere unsafe.' }, 400)
    }
  } catch {
    return json({ ok: false, error: 'The catalogue did not respond in time.' }, 502)
  }
  if (!response.ok) return json({ ok: false, error: `The catalogue returned ${response.status}.` }, 502)
  const type = response.headers.get('content-type') ?? ''
  if (!/xml|atom|opds/i.test(type)) return json({ ok: false, error: 'That address is not an OPDS catalogue.' }, 422)
  const text = await response.text()
  if (text.length > 4_000_000) return json({ ok: false, error: 'That catalogue page is too large.' }, 413)
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'private, max-age=60' },
  })
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
    if (url.pathname === '/api/materials') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return findMaterials(request, env)
    }
    if (url.pathname === '/api/opds') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return proxyCatalogue(request)
    }
    if (url.pathname === '/api/define') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return defineWord(request)
    }
    if (url.pathname === '/api/quiz') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return quizTopic(request, env)
    }
    if (url.pathname === '/api/clarify') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
      return clarifyGoal(request, env)
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
