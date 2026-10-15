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

describe('whole answers from Gemini', () => {
  const answer = (text: string, finishReason = 'STOP') =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }))
  const ask = (ip: string) =>
    call(
      '/api/tutor',
      { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ question: 'What is this?' }) },
      { GEMINI_API_KEY: 'k' },
    )
  const body = (mock: ReturnType<typeof vi.fn>, index: number) =>
    JSON.parse(String((mock.mock.calls[index] as unknown as [string, RequestInit])[1].body))

  it('turns thinking off so the allowance goes to the answer', async () => {
    const mock = vi.fn(async () => answer('A whole answer.'))
    vi.stubGlobal('fetch', mock)
    const result = (await (await ask('7.7.7.1')).json()) as { text: string }
    expect(result.text).toBe('A whole answer.')
    expect(body(mock, 0).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('asks again with more room when an answer stops at the limit', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(answer('A half', 'MAX_TOKENS'))
      .mockResolvedValueOnce(answer('A half, then the rest.'))
    vi.stubGlobal('fetch', mock)
    const result = (await (await ask('7.7.7.2')).json()) as { text: string }
    expect(result.text).toBe('A half, then the rest.')
    expect(body(mock, 1).generationConfig.maxOutputTokens).toBeGreaterThan(
      body(mock, 0).generationConfig.maxOutputTokens,
    )
  })

  it('asks without the thinking setting, with room for thinking, when a model refuses it', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'thinking not supported' } }), { status: 400 }),
      )
      .mockResolvedValueOnce(answer('Answered anyway.'))
    vi.stubGlobal('fetch', mock)
    const result = (await (await ask('7.7.7.3')).json()) as { text: string }
    expect(result.text).toBe('Answered anyway.')
    expect(body(mock, 1).generationConfig.thinkingConfig).toBeUndefined()
    expect(body(mock, 1).generationConfig.maxOutputTokens).toBeGreaterThan(4000)
  })

  it('leaves thought parts out of the answer', async () => {
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'The answer.' }] } }],
          }),
        ),
    )
    vi.stubGlobal('fetch', mock)
    expect(((await (await ask('7.7.7.4')).json()) as { text: string }).text).toBe('The answer.')
  })
})

describe('book lookup', () => {
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

  it('answers null when nothing matches closely, and 502 when the catalog is down', async () => {
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

  it('reports an outage only when both catalogs fail', async () => {
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
      {
        title: 'Foundations of psychology',
        description: 'The core ideas.',
        covers: ['Memory', 'Learning', 7],
        fits: 'Anyone starting out.',
      },
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
      focuses: Array<{ title: string; covers: string[]; fits: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.broad).toBe(true)
    expect(body.focuses.map((focus) => focus.title)).toEqual(['Foundations of psychology', 'Clinical psychology'])
    expect(body.focuses[0].covers).toEqual(['Memory', 'Learning'])
    expect(body.focuses[0].fits).toBe('Anyone starting out.')
  })

  it('rejects an empty goal', async () => {
    expect((await ask('', '7.7.9.2')).status).toBe(400)
  })
})

describe('define route', () => {
  const ask = (word: string, ip: string) =>
    call(`/api/define?word=${encodeURIComponent(word)}`, { headers: { 'cf-connecting-ip': ip } }, {})

  it('returns the first meanings of a word', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                phonetic: '/ˈɛfəmərəl/',
                meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Lasting a very short time.' }] }],
              },
            ]),
          ),
      ),
    )
    const body = (await (await ask('ephemeral', '7.9.3.1')).json()) as { found: boolean; meanings: unknown[] }
    expect(body.found).toBe(true)
    expect(body.meanings).toHaveLength(1)
  })

  it('says so when a word is not found, and rejects more than one word', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    )
    expect(((await (await ask('zzzxq', '7.9.3.2')).json()) as { found: boolean }).found).toBe(false)
    expect((await ask('two words', '7.9.3.3')).status).toBe(400)
  })
})

describe('Standard Ebooks search', () => {
  it('reads an OPDS entry into a result with an EPUB download', async () => {
    const { parseStandardEbooks } = await import('../worker')
    const xml = `<feed><entry>
      <id>https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice</id>
      <title>Pride and Prejudice</title>
      <author><name>Jane Austen</name><uri>https://standardebooks.org/ebooks/jane-austen</uri></author>
      <published>2014-05-25T00:00:00Z</published>
      <summary type="text">A Regency-era novel &amp; more.</summary>
      <link href="https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg" rel="http://opds-spec.org/image/thumbnail" type="image/jpeg"/>
      <link href="https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=feed" length="1" rel="http://opds-spec.org/acquisition/open-access" title="Recommended compatible epub" type="application/epub+zip" />
      <link href="https://standardebooks.org/x.azw3" rel="http://opds-spec.org/acquisition/open-access" title="Amazon Kindle azw3" type="application/x-mobipocket-ebook" />
    </entry></feed>`
    const [book] = parseStandardEbooks(xml)
    expect(book).toMatchObject({
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      year: 2014,
      source: 'Standard Ebooks',
      format: 'EPUB',
      free: true,
      description: 'A Regency-era novel & more.',
    })
    expect(book.downloadUrl).toBe(
      'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=feed',
    )
    expect(book.coverUrl).toContain('cover-thumbnail.jpg')
  })
})

describe('opds proxy', () => {
  const ask = (target: string, ip: string) =>
    call(`/api/opds?url=${encodeURIComponent(target)}`, { headers: { 'cf-connecting-ip': ip } }, {})

  it('passes on a public catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<feed><title>Books</title></feed>', { headers: { 'content-type': 'application/atom+xml' } }),
      ),
    )
    const response = await ask('https://books.example.com/opds', '7.9.4.1')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>Books</title>')
  })

  it('refuses private addresses, plain http and things that are not catalogs', async () => {
    expect((await ask('http://books.example.com/opds', '7.9.4.2')).status).toBe(400)
    expect((await ask('https://192.168.1.5/opds', '7.9.4.3')).status).toBe(400)
    expect((await ask('https://localhost/opds', '7.9.4.4')).status).toBe(400)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })),
    )
    expect((await ask('https://books.example.com/', '7.9.4.5')).status).toBe(422)
  })
})

describe('webdav proxy', () => {
  const ask = (body: unknown, ip: string) =>
    call(
      '/api/webdav',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      {},
    )

  it('lists a folder with the login sent along', async () => {
    const fetchMock = vi.fn(async () => new Response('<d:multistatus xmlns:d="DAV:"/>', { status: 207 }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await ask(
      { url: 'https://cloud.example.com/dav/', op: 'list', user: 'me', pass: 'secret' },
      '7.9.5.1',
    )
    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('PROPFIND')
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('me:secret')}`)
  })

  it('refuses private or plain-http addresses', async () => {
    expect((await ask({ url: 'http://cloud.example.com/dav/', op: 'list' }, '7.9.5.2')).status).toBe(400)
    expect((await ask({ url: 'https://10.0.0.5/dav/', op: 'list' }, '7.9.5.3')).status).toBe(400)
  })

  it('reports a wrong password plainly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 401 })),
    )
    const response = await ask({ url: 'https://cloud.example.com/dav/', op: 'list', user: 'a', pass: 'b' }, '7.9.5.4')
    expect(response.status).toBe(401)
    expect(((await response.json()) as { error: string }).error).toMatch(/username and password/)
  })
})

describe('cover search', () => {
  it('collects covers from both catalogs without duplicates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const address = String(input)
        if (address.includes('openlibrary.org/search.json'))
          return new Response(
            JSON.stringify({ docs: [{ cover_i: 7, title: 'Mistakes Were Made', first_publish_year: 2007 }, {}] }),
          )
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'abc',
                volumeInfo: {
                  title: 'Mistakes Were Made',
                  publishedDate: '2020-01-01',
                  imageLinks: { thumbnail: 'http://books.google.com/books/content?id=abc&zoom=1&edge=curl' },
                },
              },
            ],
          }),
        )
      }),
    )
    const response = await call('/api/covers?title=Mistakes%20Were%20Made&author=Tavris')
    const body = (await response.json()) as { covers: Array<{ id: string; thumb: string; full: string }> }
    expect(body.covers.map((cover) => cover.id)).toEqual(['ol-7', 'gb-abc'])
    expect(body.covers[1].thumb).toBe('https://books.google.com/books/content?id=abc&zoom=1')
    expect(body.covers[1].full).toContain('zoom=2')
  })

  it('only hands back pictures from known cover sites', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const refused = await call(`/api/cover?url=${encodeURIComponent('https://evil.example/a.jpg')}`)
    expect(refused.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a redirect that leaves the known sites, and non-pictures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })),
    )
    const moved = await call(`/api/cover?url=${encodeURIComponent('https://covers.openlibrary.org/b/id/1-L.jpg')}`)
    expect(moved.status).toBe(403)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })),
    )
    const page = await call(`/api/cover?url=${encodeURIComponent('https://covers.openlibrary.org/b/id/2-L.jpg')}`)
    expect(page.status).toBe(502)
  })
})

describe('things to explore for a question', () => {
  const reply = {
    hook: 'Most of it is alive',
    short: 'Good soil is loose and full of life.',
    followUp: 'How do worms help?',
    wiki: 'Soil',
    books: [{ title: 'Teaming with Microbes', author: 'Jeff Lowenfels', why: 'The soil food web' }],
    read: [
      { title: 'Real guide', source: 'RHS', url: 'https://www.rhs.org.uk/soil', minutes: 6, why: 'Plain' },
      { title: 'Made-up page', source: 'Nowhere', url: 'https://gone.example.org/soil', minutes: 4 },
    ],
    watch: [
      { title: 'Real video', url: 'https://www.youtube.com/watch?v=REALREAL11', search: 'soil', why: 'Shows it' },
      { title: 'Invented video', url: 'https://www.youtube.com/watch?v=FAKEFAKE11', search: 'soil' },
    ],
    listen: [{ search: 'soil health', why: 'An hour with a soil scientist' }],
    try: [],
    useIt: 'Squeeze a handful of your soil',
  }
  const route = (url: string): Response => {
    if (url.includes('generativelanguage'))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }))
    if (url.includes('gone.example.org')) return new Response('', { status: 404 })
    if (url.includes('rhs.org.uk')) return new Response('ok')
    if (url.includes('wikipedia.org'))
      return new Response(
        JSON.stringify({
          type: 'standard',
          title: 'Soil',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Soil' } },
        }),
      )
    if (url.includes('oembed') && url.includes('REALREAL11'))
      return new Response(
        JSON.stringify({
          title: 'Soil, explained',
          author_name: 'A Channel',
          thumbnail_url: 'https://i.ytimg.com/x.jpg',
        }),
      )
    if (url.includes('oembed')) return new Response('Not Found', { status: 404 })
    if (url.includes('itunes.apple.com'))
      return new Response(
        JSON.stringify({
          results: [
            {
              trackName: 'The living soil',
              collectionName: 'Gardeners Hour',
              trackViewUrl: 'https://podcasts.apple.com/ep/1',
              trackTimeMillis: 2_700_000,
            },
          ],
        }),
      )
    return new Response('', { status: 500 })
  }

  it('keeps only links that were confirmed, with real titles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => route(String(input instanceof Request ? input.url : input))),
    )
    const response = await call(
      '/api/question',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': '8.8.1.1' },
        body: JSON.stringify({ subject: 'Gardening', area: 'Soil', question: 'What makes soil good?' }),
      },
      { GEMINI_API_KEY: 'k' },
    )
    const body = (await response.json()) as {
      followUp: string
      books: Array<{ title: string }>
      picks: Array<{ type: string; title: string; source: string; minutes?: number }>
    }
    expect(body.followUp).toBe('How do worms help?')
    expect((body as { useIt?: string }).useIt).toBe('Squeeze a handful of your soil')
    expect(body.books.map((book) => book.title)).toEqual(['Teaming with Microbes'])
    expect(body.picks.map((pick) => `${pick.type}:${pick.title}`)).toEqual([
      'read:Soil',
      'read:Real guide',
      'watch:Soil, explained',
      'listen:The living soil',
    ])
    expect(body.picks.find((pick) => pick.type === 'listen')?.minutes).toBe(45)
  })
})

describe('public libraries', () => {
  const branch = (name: string, id: string, latitude: number, longitude: number) => ({
    city: name,
    regionCode: 'WA',
    latitude,
    longitude,
    systems: [{ name: `${name} Library`, fulfillmentId: id, type: 'Public Library', links: [] }],
  })
  it('lists only libraries near the place', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('locate.libbyapp.com'))
          return new Response(
            JSON.stringify({
              branches: [
                branch('Seattle', 'seattle', 47.6, -122.33),
                branch('Tacoma', 'tacoma', 47.25, -122.44),
                branch('Far', 'far', 31.0, 35.0),
              ],
            }),
          )
        if (url.includes('thunder.api.overdrive.com')) return new Response(JSON.stringify({ preferredKey: 'short' }))
        return new Response('', { status: 404 })
      }),
    )
    const response = await call('/api/libraries?q=98116', { headers: { 'cf-connecting-ip': '8.8.2.1' } })
    const body = (await response.json()) as { systems: Array<{ key: string; libbyKey: string; catalog?: string }> }
    expect(body.systems.map((system) => system.key)).toEqual(['seattle', 'tacoma'])
    expect(body.systems[0].libbyKey).toBe('short')
    expect(body.systems[0].catalog).toBeUndefined()
  })
})

describe('summing up an area', () => {
  it('drafts from the answers and names questions that overlap', async () => {
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        summary: 'I learned that soil is alive.',
                        merges: [{ a: 1, b: 2, text: 'How do I test my soil?' }],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        ),
    )
    vi.stubGlobal('fetch', mock)
    const response = await call(
      '/api/sumup',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': '8.8.3.1' },
        body: JSON.stringify({
          subject: 'Gardening',
          area: 'Soil',
          answers: [{ question: 'What is soil?', answer: 'Mostly alive.' }],
          questions: ['How do I test soil?', 'How can I check my soil?'],
        }),
      },
      { GEMINI_API_KEY: 'k' },
    )
    const body = (await response.json()) as { text: string; merges: unknown[] }
    expect(body.text).toBe('I learned that soil is alive.')
    expect(body.merges).toEqual([{ a: 1, b: 2, text: 'How do I test my soil?' }])
    const sent = JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent.contents[0].parts[0].text).toContain('2. How can I check my soil?')
  })
})

describe('a model that does not answer in time', () => {
  const draft = {
    title: 'Gardening',
    summary: 'Growing food.',
    areas: [
      { title: 'Soil', questions: [{ text: 'What makes soil good?' }] },
      { title: 'Water', questions: [{ text: 'How often to water?' }] },
    ],
  }
  const ask = (ip: string) =>
    call(
      '/api/subject',
      { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ goal: 'gardening' }) },
      { GEMINI_API_KEY: 'k' },
    )
  const answer = (text: string, finishReason = 'STOP') =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }))

  it('tries the next model instead of giving up', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockResolvedValueOnce(answer(JSON.stringify(draft)))
    vi.stubGlobal('fetch', mock)
    const body = (await (await ask('8.8.4.1')).json()) as { ok: boolean; draft?: { title: string } }
    expect(body.ok).toBe(true)
    expect(body.draft?.title).toBe('Gardening')
  })

  it('moves on when a JSON answer is still cut off after asking again', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(answer('{"title":"Gard', 'MAX_TOKENS'))
      .mockResolvedValueOnce(answer('{"title":"Gardening","areas":[', 'MAX_TOKENS'))
      .mockResolvedValueOnce(answer(JSON.stringify(draft)))
    vi.stubGlobal('fetch', mock)
    const body = (await (await ask('8.8.4.2')).json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it('says it took too long when no model answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }),
    )
    const response = await ask('8.8.4.3')
    expect(response.status).toBe(504)
    expect(((await response.json()) as { error: string }).error).toMatch(/too long/)
  })
})

describe('a question in two halves', () => {
  it('asks only for the answer part, quickly, without looking anything up', async () => {
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ hook: 'H', short: 'S', followUp: 'F', useIt: '' }) }] } },
            ],
          }),
        ),
    )
    vi.stubGlobal('fetch', mock)
    const response = await call(
      '/api/question',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': '8.8.5.1' },
        body: JSON.stringify({ subject: 'Gardening', question: 'What makes soil good?', part: 'answer' }),
      },
      { GEMINI_API_KEY: 'k' },
    )
    const body = (await response.json()) as { short: string; picks: unknown[] }
    expect(body.short).toBe('S')
    expect(body.picks).toEqual([])
    expect(mock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent.systemInstruction.parts[0].text).not.toContain('"books"')
    expect(sent.generationConfig.maxOutputTokens).toBeLessThanOrEqual(1_000)
  })
})
