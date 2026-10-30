// /api/article: fetches a web page for the in-app source reader. The page goes back as text inside JSON (never served
// as a page from this address), only from public https addresses, a few hops at most, and only so much of it.

export const MAX_ARTICLE_BYTES = 2_000_000
const MAX_HOPS = 4

// A public https address: no addresses inside a network, no bare numbers, no ports.
export function publicPage(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost'))
    return null
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return null
  return url
}

const answer = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function readLimited(response: Response): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ARTICLE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  const type = response.headers.get('content-type') ?? ''
  const charset = /charset=([\w-]+)/i.exec(type)?.[1]
  try {
    return new TextDecoder(charset || 'utf-8').decode(all)
  } catch {
    return new TextDecoder().decode(all)
  }
}

export async function fetchArticle(
  request: Request,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? ''
  let url = publicPage(target)
  if (!url) return answer({ ok: false, error: 'This page can’t be opened here.' }, 400)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    for (let hop = 0; ; hop += 1) {
      response = await fetcher(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'user-agent': 'Mozilla/5.0 (compatible; Noesis/1.0; +https://noesis.proairetos.com)',
        },
      })
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) break
      if (hop >= MAX_HOPS) return answer({ ok: false, error: 'The page moved too many times.' }, 502)
      const next = publicPage(new URL(location, url).toString())
      if (!next) return answer({ ok: false, error: 'This page can’t be opened here.' }, 400)
      url = next
    }
    if (!response.ok) return answer({ ok: false, error: `The site answered ${response.status}.` }, 502)
    const type = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!type.includes('html')) return answer({ ok: false, error: 'This isn’t a page to read here.' }, 415)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_ARTICLE_BYTES)
      return answer({ ok: false, error: 'This page is too long to open here.' }, 413)
    const html = await readLimited(response)
    if (html === null) return answer({ ok: false, error: 'This page is too long to open here.' }, 413)
    return answer({ ok: true, url: url.toString(), html })
  } catch {
    return answer({ ok: false, error: 'The site didn’t answer in time.' }, 504)
  } finally {
    clearTimeout(timer)
  }
}
