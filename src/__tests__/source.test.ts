// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fetchArticle, MAX_ARTICLE_BYTES, publicPage } from '../workerArticle'
import { blocksFrom, playerFor, readPage, sourceView, withoutSite } from '../lib/source'
import type { Pick } from '../lib/subjects'

const pick = (over: Partial<Pick>): Pick => ({ id: 'p', type: 'read', title: 'A page', source: 'Site', ...over })
const html = (body: string) =>
  `<!doctype html><html><head><title>On attention</title></head><body><nav>Menu</nav><article>${body}</article><footer>About us</footer></body></html>`
const essay = html(
  `<h1>On attention</h1>` +
    Array.from(
      { length: 8 },
      (_, i) =>
        `<p>Paragraph ${i + 1} about where attention goes and why it matters to the one reading this page today.</p>`,
    ).join('') +
    `<blockquote><p>Attention is the rarest form of generosity.</p></blockquote><ul><li>One thing</li><li>Another thing</li></ul>`,
)

describe('the article route', () => {
  it('takes only public https pages', () => {
    expect(publicPage('https://example.com/a')).toBeTruthy()
    for (const bad of [
      'http://example.com/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://printer.local/',
      'https://example.com:8443/',
      'https://user:pw@example.com/',
      'javascript:alert(1)',
    ])
      expect(publicPage(bad)).toBeNull()
  })

  it('follows a redirect only to another public page', async () => {
    const hops: string[] = []
    const fetcher = (async (input: URL) => {
      hops.push(input.toString())
      if (input.hostname === 'example.com')
        return new Response(null, { status: 301, headers: { location: 'https://10.0.0.1/' } })
      return new Response('x', { headers: { 'content-type': 'text/html' } })
    }) as unknown as typeof fetch
    const response = await fetchArticle(
      new Request('https://noesis.test/api/article?url=https://example.com/'),
      fetcher,
    )
    expect(response.status).toBe(400)
    expect(hops).toEqual(['https://example.com/'])
  })

  it('sends the page back as text in JSON, never as a page', async () => {
    const fetcher = (async () =>
      new Response(essay, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch
    const response = await fetchArticle(
      new Request('https://noesis.test/api/article?url=https://example.com/a'),
      fetcher,
    )
    expect(response.headers.get('content-type')).toContain('application/json')
    const data = (await response.json()) as { ok: boolean; html: string }
    expect(data.ok).toBe(true)
    expect(data.html).toContain('On attention')
  })

  it('refuses what is not a page, and pages too long', async () => {
    const pdf = (async () =>
      new Response('%PDF', { headers: { 'content-type': 'application/pdf' } })) as unknown as typeof fetch
    expect(
      (await fetchArticle(new Request('https://n.test/api/article?url=https://example.com/a.pdf'), pdf)).status,
    ).toBe(415)
    const big = (async () =>
      new Response('a'.repeat(MAX_ARTICLE_BYTES + 10), {
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch
    expect((await fetchArticle(new Request('https://n.test/api/article?url=https://example.com/'), big)).status).toBe(
      413,
    )
  })
})

describe('where a source opens', () => {
  it('plays videos and episodes in their own players', () => {
    expect(playerFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1',
    )
    expect(playerFor('https://vimeo.com/76979871')?.src).toContain('player.vimeo.com/video/76979871')
    expect(playerFor('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk')?.src).toBe(
      'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk',
    )
    expect(playerFor('https://podcasts.apple.com/us/podcast/x/id123?i=456')?.src).toBe(
      'https://embed.podcasts.apple.com/us/podcast/x/id123?i=456',
    )
    expect(playerFor('https://example.com/show.mp3')?.kind).toBe('audio')
    expect(playerFor('https://example.com/article')).toBeNull()
  })

  it('reads pages here, leaves files and books to their own places', () => {
    expect(sourceView(pick({ url: 'https://example.com/essay' }))).toBe('page')
    expect(sourceView(pick({ type: 'watch', url: 'https://youtu.be/dQw4w9WgXcQ' }))).toBe('player')
    expect(sourceView(pick({ type: 'watch', url: 'https://example.com/talk' }))).toBeNull()
    expect(sourceView(pick({ url: 'https://example.com/paper.pdf' }))).toBeNull()
    expect(sourceView(pick({ type: 'book', url: 'https://example.com/book' }))).toBeNull()
    expect(sourceView(pick({ url: undefined }))).toBeNull()
  })
})

describe('reading a page', () => {
  it('keeps the words as plain blocks, in order', () => {
    const root = new DOMParser().parseFromString(
      '<div><h2>Head</h2><p>One <b>bold</b> line.</p><script>bad()</script><blockquote><p>Quoted</p></blockquote><ul><li>Item</li></ul></div>',
      'text/html',
    ).body
    expect(blocksFrom(root)).toEqual([
      { kind: 'h', text: 'Head' },
      { kind: 'p', text: 'One bold line.' },
      { kind: 'p', text: 'Quoted' },
      { kind: 'li', text: 'Item' },
    ])
  })

  it('reads the article and leaves the page around it', async () => {
    const fetcher = (async () =>
      Response.json({ ok: true, url: 'https://example.com/a', html: essay })) as unknown as typeof fetch
    const page = await readPage('https://example.com/a', fetcher)
    expect(page.title).toBe('On attention')
    expect(page.site).toBe('example.com')
    expect(page.blocks.some((block) => block.text.includes('Paragraph 3'))).toBe(true)
    expect(page.blocks.some((block) => block.text.includes('About us') || block.text === 'Menu')).toBe(false)
    expect(page.minutes).toBeGreaterThanOrEqual(1)
  })

  it('takes the site’s name off a title', () => {
    expect(withoutSite('Dream - Wikipedia', 'en.wikipedia.org')).toBe('Dream')
    expect(withoutSite('Why we sleep | Aeon Essays', 'Aeon')).toBe('Why we sleep')
    expect(withoutSite('Mind - body problem', 'example.com')).toBe('Mind - body problem')
  })

  it('says plainly when a page cannot be read', async () => {
    const fetcher = (async () =>
      Response.json({ ok: false, error: 'The site answered 403.' }, { status: 502 })) as unknown as typeof fetch
    await expect(readPage('https://example.com/a', fetcher)).rejects.toThrow('The site answered 403.')
  })
})
