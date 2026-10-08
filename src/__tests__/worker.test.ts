import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker'

const env = { ASSETS: { fetch: async () => new Response('asset') } }
const call = (path: string, init?: RequestInit, extra: Record<string, unknown> = {}) =>
  worker.fetch(new Request(`https://noesis.test${path}`, init), { ...env, ...extra })

afterEach(() => vi.unstubAllGlobals())

describe('worker', () => {
  it('hides /api/models unless the admin token matches', async () => {
    expect((await call('/api/models', undefined, { GEMINI_API_KEY: 'k' })).status).toBe(404)
    expect(
      (
        await call(
          '/api/models',
          { headers: { 'x-admin-token': 'nope' } },
          { GEMINI_API_KEY: 'k', ADMIN_TOKEN: 'secret' },
        )
      ).status,
    ).toBe(404)
  })

  it('requires a session for the tutor when TUTOR_REQUIRE_AUTH is on', async () => {
    const response = await call(
      '/api/tutor',
      { method: 'POST', body: JSON.stringify({ question: 'What is this?' }) },
      { GEMINI_API_KEY: 'k', TUTOR_REQUIRE_AUTH: 'true' },
    )
    expect(response.status).toBe(401)
  })

  it('sends the Gemini key in a header, never the URL', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await call(
      '/api/tutor',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': '1.1.1.1' },
        body: JSON.stringify({ question: 'What is this?' }),
      },
      { GEMINI_API_KEY: 'secret-key' },
    )
    expect(response.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
  })

  it('rate limits the tutor per client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }))),
    )
    const send = () =>
      call(
        '/api/tutor',
        {
          method: 'POST',
          headers: { 'cf-connecting-ip': '2.2.2.2' },
          body: JSON.stringify({ question: 'What is this?' }),
        },
        { GEMINI_API_KEY: 'k' },
      )
    let status = 200
    for (let i = 0; i < 25; i += 1) status = (await send()).status
    expect(status).toBe(429)
  })

  it('refuses resources outside the allowlist', async () => {
    expect((await call('/api/resource?url=https://evil.example/book.epub')).status).toBe(403)
    expect((await call('/api/resource?url=http://gutenberg.org/book.epub')).status).toBe(403)
  })

  it('refuses redirects that leave the allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })),
    )
    expect(
      (await call('/api/resource?url=https://www.gutenberg.org/a.epub', { headers: { 'cf-connecting-ip': '3.3.3.3' } }))
        .status,
    ).toBe(403)
  })

  it('rejects oversized resources by content-length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { headers: { 'content-length': String(500 * 1024 * 1024) } })),
    )
    expect(
      (await call('/api/resource?url=https://www.gutenberg.org/a.epub', { headers: { 'cf-connecting-ip': '4.4.4.4' } }))
        .status,
    ).toBe(413)
  })
})

describe('review route', () => {
  const geminiReply = (text: string) =>
    vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })))
  const post = (body: unknown, ip: string) =>
    call(
      '/api/review',
      { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) },
      { GEMINI_API_KEY: 'k' },
    )
  const passage = 'Photosynthesis converts light energy into chemical energy stored in sugars inside plant cells.'

  it('rejects a passage that is too short', async () => {
    expect((await post({ passage: 'too short' }, '5.5.5.1')).status).toBe(400)
  })

  it('returns validated cards and asks Gemini for JSON', async () => {
    const mock = geminiReply(
      JSON.stringify([
        { question: 'What does photosynthesis do?', answer: 'It turns light into chemical energy.' },
        { question: '', answer: 'dropped' },
      ]),
    )
    vi.stubGlobal('fetch', mock)
    const response = await post({ passage, count: 3 }, '5.5.5.2')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { cards: unknown[] }).cards).toHaveLength(1)
    const init = (mock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body)).generationConfig.responseMimeType).toBe('application/json')
  })

  it('fails cleanly when the model returns non-JSON', async () => {
    vi.stubGlobal('fetch', geminiReply('not json at all'))
    expect((await post({ passage }, '5.5.5.3')).status).toBe(502)
  })

  it('only accepts POST', async () => {
    expect((await call('/api/review')).status).toBe(405)
  })
})

describe('tutor answer length', () => {
  const reply = () =>
    vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })))
  const ask = (length: unknown, ip: string) =>
    call(
      '/api/tutor',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip },
        body: JSON.stringify({ question: 'What is this?', length }),
      },
      { GEMINI_API_KEY: 'k' },
    )
  const sent = (mock: ReturnType<typeof reply>) =>
    JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body))

  it('asks for short answers and fewer tokens when concise', async () => {
    const mock = reply()
    vi.stubGlobal('fetch', mock)
    await ask('concise', '6.6.6.1')
    const body = sent(mock)
    expect(body.generationConfig.maxOutputTokens).toBe(450)
    expect(body.systemInstruction.parts[0].text).toContain('Keep the answer short')
  })

  it('allows longer answers when detailed', async () => {
    const mock = reply()
    vi.stubGlobal('fetch', mock)
    await ask('detailed', '6.6.6.2')
    expect(sent(mock).generationConfig.maxOutputTokens).toBe(1500)
  })

  it('falls back to balanced for unknown values', async () => {
    const mock = reply()
    vi.stubGlobal('fetch', mock)
    await ask('enormous', '6.6.6.3')
    expect(sent(mock).generationConfig.maxOutputTokens).toBe(800)
  })
})
