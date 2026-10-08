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

describe('learning path routes', () => {
  const plan = {
    paths: [
      {
        title: 'Foundations',
        summary: 'Start here.',
        weeks: '6–8 weeks',
        level: 'Beginner',
        milestones: [
          { title: 'Basics', topics: ['One', 'Two'] },
          { title: 'Next', topics: ['Three'] },
        ],
      },
    ],
    books: [{ title: 'Computer Networking: A Top-Down Approach', author: 'Kurose', note: 'Best overview' }],
    resources: [
      { title: 'Working site', publisher: 'A', url: 'https://good.example.com/course', kind: 'Free course' },
      { title: 'Gone page', publisher: 'B', url: 'https://gone.example.com/missing', kind: 'Free course' },
      { title: 'Unreachable', publisher: 'C', url: 'https://down.example.com/', kind: 'Free course' },
    ],
  }
  const geminiThen = (checks: (url: string) => Response | Promise<Response>) =>
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('generativelanguage'))
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }))
      return checks(url)
    })
  const ask = (goal: unknown, ip: string) =>
    call(
      '/api/path',
      { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ goal }) },
      { GEMINI_API_KEY: 'k' },
    )

  it('rejects a goal that is too short', async () => {
    expect((await ask('hi', '7.7.7.1')).status).toBe(400)
  })

  it('returns a cleaned plan and drops links that are gone or unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      geminiThen((url) => {
        if (url.startsWith('https://good.')) return new Response('x', { status: 206 })
        if (url.startsWith('https://gone.')) return new Response('nope', { status: 404 })
        throw new Error('network down')
      }),
    )
    const response = await ask('I want to understand networking from scratch', '7.7.7.2')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      suggestion: { paths: unknown[]; resources: Array<{ title: string }>; books: unknown[] }
    }
    expect(body.suggestion.paths).toHaveLength(1)
    expect(body.suggestion.books).toHaveLength(1)
    expect(body.suggestion.resources.map((resource) => resource.title)).toEqual(['Working site'])
  })

  it('keeps a link whose site blocks bots', async () => {
    vi.stubGlobal(
      'fetch',
      geminiThen(() => new Response('blocked', { status: 403 })),
    )
    const body = (await (await ask('I want to understand networking from scratch', '7.7.7.3')).json()) as {
      suggestion: { resources: unknown[] }
    }
    expect(body.suggestion.resources).toHaveLength(3)
  })

  it('asks the model for study hours, outcomes and a reading list per path', async () => {
    const mock = geminiThen(() => new Response('ok'))
    vi.stubGlobal('fetch', mock)
    await ask('I want to understand networking from scratch', '7.7.7.9')
    const sent = JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const instructions = sent.systemInstruction.parts[0].text as string
    expect(instructions).toContain('"hours"')
    expect(instructions).toContain('"outcome"')
    expect(instructions).toContain('"reading"')
    expect(instructions).toContain('six real, published books')
    expect(instructions).not.toContain('"weeks"')
  })

  it('builds one path per chosen focus area and passes level and purpose along', async () => {
    const mock = geminiThen(() => new Response('ok'))
    vi.stubGlobal('fetch', mock)
    await call(
      '/api/path',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': '7.7.8.1' },
        body: JSON.stringify({
          goal: 'Psychology',
          focuses: ['Foundations of psychology', 'Clinical psychology'],
          level: 'Complete beginner',
          purpose: 'School or an exam',
        }),
      },
      { GEMINI_API_KEY: 'k' },
    )
    const sent = JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const instructions = sent.systemInstruction.parts[0].text as string
    expect(instructions).toContain('exactly 2 paths')
    expect(instructions).toContain('"Foundations of psychology", "Clinical psychology"')
    expect(instructions).toContain('Complete beginner')
    expect(instructions).toContain('School or an exam')
  })

  it('fails cleanly when the model returns something unusable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"paths":[]}' }] } }] })),
      ),
    )
    expect((await ask('I want to understand networking from scratch', '7.7.7.4')).status).toBe(502)
  })

  const volume = (title: string, authors: string[], extra: Record<string, unknown> = {}) => ({
    volumeInfo: {
      title,
      authors,
      publishedDate: '2021-03-01',
      industryIdentifiers: [
        { type: 'ISBN_10', identifier: '0136681557' },
        { type: 'ISBN_13', identifier: '9780136681557' },
      ],
      imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' },
      averageRating: 4.5,
      ratingsCount: 200,
      infoLink: 'http://books.google.com/info',
      ...extra,
    },
    saleInfo: {
      saleability: 'FOR_SALE',
      buyLink: 'https://play.google.com/store/books/details?id=abc',
      listPrice: { amount: 49.99, currencyCode: 'USD' },
    },
  })
  const lookup = (query: string, ip: string) =>
    call(`/api/book?${query}`, { headers: { 'cf-connecting-ip': ip } }, { GOOGLE_BOOKS_API_KEY: 'key123' })

  it('finds a real book with cover, rating, price and store links', async () => {
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [volume('Computer Networking', ['James Kurose'], { subtitle: 'A Top-Down Approach' })],
          }),
        ),
    )
    vi.stubGlobal('fetch', mock)
    const response = await lookup(
      'title=Computer%20Networking%3A%20A%20Top-Down%20Approach&author=Kurose&note=Best%20overview',
      '8.8.8.1',
    )
    const body = (await response.json()) as {
      book: {
        title: string
        coverUrl: string
        rating: number
        price: string
        note: string
        buy: Array<{ store: string; url: string }>
      }
    }
    expect(body.book.title).toBe('Computer Networking: A Top-Down Approach')
    expect(body.book.coverUrl.startsWith('https://')).toBe(true)
    expect(body.book.rating).toBe(4.5)
    expect(body.book.price).toBe('$49.99')
    expect(body.book.note).toBe('Best overview')
    expect(body.book.buy.map((link) => link.store)).toEqual([
      'Bookshop.org',
      'Amazon',
      'Google Play Books',
      'Find in a library',
    ])
    expect(String((mock.mock.calls[0] as unknown as [string])[0])).toContain('key=key123')
  })

  it('answers null when nothing matches closely, and 502 when the catalogue is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [volume('Gardening for Beginners', ['Pat Green'])] }))),
    )
    expect(
      ((await (await lookup('title=Network%20Warrior&author=Donahue', '8.8.8.2')).json()) as { book: unknown }).book,
    ).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('quota', { status: 429 })),
    )
    expect((await lookup('title=Network%20Warrior', '8.8.8.3')).status).toBe(502)
  })

  it('requires a title and only accepts GET', async () => {
    expect((await lookup('author=x', '8.8.8.4')).status).toBe(400)
    expect((await call('/api/book', { method: 'POST' })).status).toBe(405)
  })
})

describe('when Gemini is overloaded', () => {
  const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }))
  const overloaded = () =>
    new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), {
      status: 503,
    })
  const ask = (ip: string) =>
    call(
      '/api/tutor',
      { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ question: 'What is this?' }) },
      { GEMINI_API_KEY: 'k' },
    )
  const modelOf = (call: unknown[]) => decodeURIComponent(String(call[0]).split('/models/')[1].split(':')[0])

  it('falls back to a lighter model instead of giving up', async () => {
    const mock = vi.fn(async (input: string | URL) => (/flash-lite/.test(String(input)) ? ok() : overloaded()))
    vi.stubGlobal('fetch', mock)
    const response = await ask('9.9.9.1')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { model: string }).model).toMatch(/flash-lite/)
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('treats a rate-limited model as a reason to try the next one', async () => {
    const mock = vi.fn(async (input: string | URL) =>
      /flash-lite/.test(String(input))
        ? ok()
        : new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }),
    )
    vi.stubGlobal('fetch', mock)
    expect((await ask('9.9.9.2')).status).toBe(200)
  })

  it('pauses and tries every model again before giving up, then shows a friendly message', async () => {
    vi.useFakeTimers()
    try {
      const mock = vi.fn(async () => overloaded())
      vi.stubGlobal('fetch', mock)
      const pending = ask('9.9.9.3')
      await vi.advanceTimersByTimeAsync(3_000)
      const response = await pending
      expect(response.status).toBe(503)
      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('Noema is very busy right now. Please try again in a moment.')
      expect(body.error).not.toMatch(/Gemini|503/)
      const models = mock.mock.calls.map((entry) => modelOf(entry as unknown[]))
      expect(models.length).toBeGreaterThanOrEqual(8) // two rounds over at least four models
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry a request that is simply wrong', async () => {
    const mock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 403 }),
    )
    vi.stubGlobal('fetch', mock)
    const response = await ask('9.9.9.4')
    expect(response.status).toBe(502)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('book ratings from two sources', () => {
  const lookup = (query: string, ip: string) => call(`/api/book?${query}`, { headers: { 'cf-connecting-ip': ip } })
  const google = (extra: Record<string, unknown> = {}) => ({
    items: [
      {
        volumeInfo: {
          title: 'Network Warrior',
          authors: ['Gary Donahue'],
          publishedDate: '2011',
          averageRating: 4,
          ratingsCount: 100,
          ...extra,
        },
      },
    ],
  })
  const openLibrary = (docs: unknown[]) => ({ docs })
  const route = (googleBody: unknown | null, olBody: unknown | null) =>
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      const body = url.includes('googleapis.com') ? googleBody : olBody
      if (body === null) return new Response('down', { status: 500 })
      return new Response(JSON.stringify(body))
    })

  it('combines the ratings from Google Books and Open Library', async () => {
    vi.stubGlobal(
      'fetch',
      route(
        google(),
        openLibrary([
          {
            title: 'Network Warrior',
            author_name: ['Gary Donahue'],
            ratings_average: 5,
            ratings_count: 100,
            cover_i: 77,
          },
        ]),
      ),
    )
    const body = (await (await lookup('title=Network%20Warrior&author=Donahue', '10.0.0.1')).json()) as {
      book: { rating: number; ratingsCount: number; ratings: Array<{ source: string }>; coverUrl: string }
    }
    expect(body.book.rating).toBe(4.5)
    expect(body.book.ratingsCount).toBe(200)
    expect(body.book.ratings.map((part) => part.source)).toEqual(['Google Books', 'Open Library'])
    expect(body.book.coverUrl).toContain('covers.openlibrary.org/b/id/77')
  })

  it('still answers from Open Library when Google Books is down', async () => {
    vi.stubGlobal(
      'fetch',
      route(
        null,
        openLibrary([
          {
            title: 'Network Warrior',
            author_name: ['Gary Donahue'],
            ratings_average: 4.2,
            ratings_count: 60,
            first_publish_year: 2007,
          },
        ]),
      ),
    )
    const response = await lookup('title=Network%20Warrior&author=Donahue', '10.0.0.2')
    const body = (await response.json()) as { book: { title: string; year: number; rating: number; buy: unknown[] } }
    expect(response.status).toBe(200)
    expect(body.book).toMatchObject({ title: 'Network Warrior', year: 2007, rating: 4.2 })
    expect(body.book.buy.length).toBeGreaterThan(0)
  })

  it('works with Google Books alone when Open Library is down', async () => {
    vi.stubGlobal('fetch', route(google(), null))
    const body = (await (await lookup('title=Network%20Warrior&author=Donahue', '10.0.0.3')).json()) as {
      book: { rating: number; ratings: unknown[] }
    }
    expect(body.book.rating).toBe(4)
    expect(body.book.ratings).toHaveLength(1)
  })

  it('reports an outage only when both catalogues fail', async () => {
    vi.stubGlobal('fetch', route(null, null))
    expect((await lookup('title=Network%20Warrior', '10.0.0.4')).status).toBe(502)
  })

  it('does not accept an Open Library match that is a different book', async () => {
    vi.stubGlobal(
      'fetch',
      route(
        google({ title: 'Something Else', authors: ['Other Person'] }),
        openLibrary([{ title: 'Gardening Basics', author_name: ['Pat Green'], ratings_average: 5, ratings_count: 9 }]),
      ),
    )
    const body = (await (await lookup('title=Network%20Warrior&author=Donahue', '10.0.0.5')).json()) as {
      book: unknown
    }
    expect(body.book).toBeNull()
  })
})

describe('clarify route', () => {
  const focusReply = {
    topic: 'Psychology',
    broad: true,
    focuses: [
      { title: 'Foundations of psychology', description: 'The core ideas.' },
      { title: 'Clinical psychology', description: 'Mental health and treatment.' },
      { title: '', description: 'dropped' },
    ],
  }
  const ask = (goal: unknown, ip: string) =>
    call(
      '/api/clarify',
      { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ goal }) },
      { GEMINI_API_KEY: 'k' },
    )

  it('turns a broad subject into specific focus areas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(focusReply) }] } }] }),
          ),
      ),
    )
    const body = (await (await ask('Psychology', '7.7.9.1')).json()) as {
      ok: boolean
      broad: boolean
      focuses: Array<{ title: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.broad).toBe(true)
    expect(body.focuses.map((focus) => focus.title)).toEqual(['Foundations of psychology', 'Clinical psychology'])
  })

  it('rejects an empty goal', async () => {
    expect((await ask('', '7.7.9.2')).status).toBe(400)
  })
})
