type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> }
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
  GEMINI_TUTOR_MODEL?: string
}

const MAX_QUESTION_LENGTH = 2_000
const MAX_CONTEXT_LENGTH = 32_000
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

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
  if (question.length < 2) return json({ ok: false, error: 'Ask GAYL a question first.' }, 400)

  const context = typeof input.context === 'string' ? input.context.slice(0, MAX_CONTEXT_LENGTH) : ''
  const book = typeof input.book === 'string' ? input.book.slice(0, 2_000) : ''
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
  if (!apiKey) return json({ ok: false, error: 'GEMINI_API_KEY is not configured in Cloudflare.' }, 503)

  const model = env.GEMINI_TUTOR_MODEL?.trim() || 'gemini-2.5-flash'
  const system = [
    'You are GAYL, a calm and practical learning guide inside Noesis.',
    'Answer the learner directly in plain text. Use the supplied book and Second Brain context first.',
    'When the context does not contain enough evidence, say that clearly and offer a useful next step.',
    'Do not invent quotations or pretend to have read a book that is not in the supplied context.',
    'Keep the answer focused unless the learner asks for a deep explanation.',
  ].join(' ')
  const prompt = [`Current book context:\n${book || '(none)'}`, `Second Brain notes:\n${context || '(none)'}`, `Learner question:\n${question}`].join('\n\n')

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
    return json({ ok: false, error: 'GAYL could not reach Gemini right now.' }, 502)
  }

  if (!response.ok) {
    if (response.status === 429) return json({ ok: false, error: 'Gemini is busy. Try again in a moment.' }, 429)
    return json({ ok: false, error: `Gemini request failed (${response.status}) using ${model}.` }, 502)
  }

  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''
  return text ? json({ ok: true, text }) : json({ ok: false, error: 'Gemini returned an empty answer.' }, 502)
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
    return env.ASSETS.fetch(request)
  },
}

export default worker
