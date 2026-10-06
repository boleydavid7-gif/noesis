type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> }
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
  GEMINI_TUTOR_MODEL?: string
}

const MAX_QUESTION_LENGTH = 2_000
const MAX_CONTEXT_LENGTH = 32_000
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_SEARCH_LENGTH = 160

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function answerTutor(request: Request, env: Env): Promise<Response> {
  let input: { question?: unknown; context?: unknown; book?: unknown }
  try {
    input = (await request.json()) as typeof input
  } catch {
    return json({ ok: false, error: 'Send a valid JSON request.' }, 400)
  }

  const question = typeof input.question === 'string' ? input.question.trim().slice(0, MAX_QUESTION_LENGTH) : ''
  if (question.length < 2) return json({ ok: false, error: 'Ask Noema a question first.' }, 400)

  const context = typeof input.context === 'string' ? input.context.slice(0, MAX_CONTEXT_LENGTH) : ''
  const book = typeof input.book === 'string' ? input.book.slice(0, 2_000) : ''
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
  if (!apiKey) return json({ ok: false, error: 'GEMINI_API_KEY is not configured in Cloudflare.' }, 503)

  const configuredModel = env.GEMINI_TUTOR_MODEL?.trim() || 'gemini-flash-latest'
  const models = [...new Set([configuredModel, 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash'])]
  const system = [
    'You are Noema, a calm and practical learning guide inside Noesis.',
    'Answer the learner directly in plain text. Use the supplied book and Second Brain context first.',
    'When the context does not contain enough evidence, say that clearly and offer a useful next step.',
    'Do not invent quotations or pretend to have read a book that is not in the supplied context.',
    'Keep the answer focused unless the learner asks for a deep explanation.',
  ].join(' ')
  const prompt = [`Current book context:\n${book || '(none)'}`, `Second Brain notes:\n${context || '(none)'}`, `Learner question:\n${question}`].join('\n\n')

  let lastStatus = 0
  let lastDetail = ''
  for (const model of models) {
    let response: Response
    try {
      response = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.35, maxOutputTokens: 800 },
        }),
      })
    } catch {
      return json({ ok: false, error: 'Noema could not reach Gemini right now.' }, 502)
    }

    if (response.ok) {
      const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''
      return text ? json({ ok: true, text, model }) : json({ ok: false, error: 'Gemini returned an empty answer.' }, 502)
    }

    lastStatus = response.status
    try {
      const providerError = (await response.clone().json()) as { error?: { message?: string } }
      lastDetail = providerError.error?.message?.slice(0, 240) ?? ''
    } catch {
      lastDetail = ''
    }
    if (response.status === 429) return json({ ok: false, error: 'Gemini is busy. Try again in a moment.' }, 429)
    if (![404, 500, 502, 503, 504].includes(response.status)) break
  }
  return json({ ok: false, error: `Gemini request failed (${lastStatus}) after trying available tutor models.${lastDetail ? ` ${lastDetail}` : ''}` }, 502)
}

type SearchResult = {
  id: string
  title: string
  author: string
  year?: number
  coverUrl?: string
  source: string
  sourceUrl: string
  free: boolean
  format: string
  downloadUrl?: string
  kind: 'book' | 'article'
}

async function searchFreeResources(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, MAX_SEARCH_LENGTH) ?? ''
    if (query.length < 2) return json({ ok: false, error: 'Enter at least two characters to search.' }, 400)
    const encoded = encodeURIComponent(query)
    const openLibrary = fetch(`https://openlibrary.org/search.json?q=${encoded}&limit=12&fields=key,title,author_name,cover_i,first_publish_year`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as { docs?: Array<{ key?: string; title?: string; author_name?: string[]; cover_i?: number; first_publish_year?: number }> }
        return (body.docs ?? []).filter((item) => item && typeof item.title === 'string').map((item, index): SearchResult => ({
          id: item.key ?? `${item.title}-${index}`, title: item.title ?? 'Untitled', author: item.author_name?.slice(0, 2).join(', ') || 'Unknown author', year: item.first_publish_year,
          coverUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : undefined,
          source: 'Open Library', sourceUrl: `https://openlibrary.org${item.key ?? ''}`, free: false, format: 'Book metadata', kind: 'book',
        }))
      }).catch(() => [] as SearchResult[])
    const gutenberg = fetch(`https://gutendex.com/books/?search=${encoded}`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as { results?: Array<{ id?: number; title?: string; authors?: Array<{ name?: string }>; copyright?: boolean; formats?: Record<string, string> }> }
        return (body.results ?? []).filter((item) => item && typeof item.title === 'string').slice(0, 12).map((item): SearchResult => ({
          id: String(item.id ?? item.title), title: item.title ?? 'Untitled', author: item.authors?.map((author) => author?.name).filter(Boolean).join(', ') || 'Unknown author',
          coverUrl: item.formats?.['image/jpeg'], source: 'Project Gutenberg', sourceUrl: `https://www.gutenberg.org/ebooks/${item.id ?? ''}`, downloadUrl: item.formats?.['application/epub+zip'] || item.formats?.['application/pdf'], free: item.copyright === false, format: item.formats?.['application/epub+zip'] ? 'EPUB' : 'Public domain', kind: 'book',
        }))
      }).catch(() => [] as SearchResult[])
    const academic = fetch(`https://api.openalex.org/works?search=${encoded}&filter=is_oa:true&per-page=12&mailto=noesis@proairetos.com`, { headers: { accept: 'application/json', 'user-agent': 'Noesis/1.0 (reader learning app)' } })
      .then(async (response) => {
        if (!response.ok) return [] as SearchResult[]
        const body = JSON.parse(await response.text()) as { results?: Array<{ id?: string; title?: string; publication_year?: number; authorships?: Array<{ author?: { display_name?: string } }>; doi?: string; primary_location?: { landing_page_url?: string; pdf_url?: string; source?: { display_name?: string } }; open_access?: { is_oa?: boolean } }> }
        return (body.results ?? []).filter((item) => item && typeof item.title === 'string').map((item, index): SearchResult => ({
          id: item.id ?? `${item.title}-${index}`, title: item.title ?? 'Untitled article', author: item.authorships?.slice(0, 3).map((entry) => entry.author?.display_name).filter(Boolean).join(', ') || 'Unknown author', year: item.publication_year,
          source: 'OpenAlex', sourceUrl: item.primary_location?.landing_page_url || item.doi || item.id || '', downloadUrl: item.primary_location?.pdf_url, free: item.open_access?.is_oa === true, format: item.primary_location?.pdf_url ? 'Open-access PDF' : 'Academic article', kind: 'article',
        }))
      }).catch(() => [] as SearchResult[])
    const [library, gutenbergResults, academicResults] = await Promise.all([openLibrary, gutenberg, academic])
    return json({ ok: true, results: [...gutenbergResults, ...academicResults, ...library] })
  } catch {
    return json({ ok: false, error: 'Free-resource search is temporarily unavailable.' }, 502)
  }
}

const RESOURCE_HOSTS = ['gutenberg.org', 'archive.org', 'arxiv.org', 'nih.gov', 'pmc.ncbi.nlm.nih.gov', 'zenodo.org', 'doaj.org']

async function proxyResource(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url')
  if (!target) return json({ ok: false, error: 'A resource URL is required.' }, 400)
  let url: URL
  try { url = new URL(target) } catch { return json({ ok: false, error: 'The resource URL is invalid.' }, 400) }
  if (url.protocol !== 'https:' || !RESOURCE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return json({ ok: false, error: 'This resource cannot be imported directly. Open the source page instead.' }, 403)
  const response = await fetch(url, { headers: { accept: 'application/epub+zip,application/pdf,*/*' } })
  if (!response.ok) return json({ ok: false, error: `The source returned ${response.status}.` }, 502)
  const headers = new Headers({ 'cache-control': 'public, max-age=3600', 'content-type': response.headers.get('content-type') || 'application/octet-stream' })
  return new Response(response.body, { status: response.status, headers })
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, worker: 'noesis-dev', geminiConfigured: Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) })
    }
    if (url.pathname === '/api/models' && request.method === 'GET') {
      const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
      if (!apiKey) return json({ ok: false, error: 'GEMINI_API_KEY is not configured.' }, 503)
      let response: Response
      try {
        response = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(apiKey)}`)
      } catch {
        return json({ ok: false, error: 'Gemini model discovery could not reach Google.' }, 502)
      }
      let body: { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
      try {
        body = (await response.json()) as typeof body
      } catch {
        return json({ ok: false, error: `Gemini model discovery returned a non-JSON response (${response.status}).` }, 502)
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
    if (url.pathname === '/api/search' && request.method === 'GET') return searchFreeResources(request)
    if (url.pathname === '/api/resource' && request.method === 'GET') return proxyResource(request)
    return env.ASSETS.fetch(request)
  },
}

export default worker
