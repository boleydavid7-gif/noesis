// A link that carries a few quotes inside it, so nothing is stored on a server.

export type SharedQuote = { text: string; source: string }
export type SharedCollection = { title: string; quotes: SharedQuote[] }

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer.write(bytes as unknown as BufferSource)
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

const MAX_QUOTES = 25

export async function encodeCollection(collection: SharedCollection): Promise<string> {
  const clean: SharedCollection = {
    title: collection.title.slice(0, 80),
    quotes: collection.quotes.slice(0, MAX_QUOTES).map((quote) => ({
      text: quote.text.slice(0, 600),
      source: quote.source.slice(0, 120),
    })),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(clean))
  if (typeof CompressionStream === 'undefined') return `p.${toBase64Url(bytes)}`
  return `z.${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`
}

export async function decodeCollection(code: string): Promise<SharedCollection | null> {
  try {
    const [kind, data] = [code.slice(0, 1), code.slice(2)]
    let bytes: Uint8Array = fromBase64Url(data)
    if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SharedCollection
    if (typeof parsed.title !== 'string' || !Array.isArray(parsed.quotes)) return null
    return {
      title: parsed.title.slice(0, 80),
      quotes: parsed.quotes
        .filter((quote) => typeof quote?.text === 'string')
        .slice(0, MAX_QUOTES)
        .map((quote) => ({ text: quote.text.slice(0, 600), source: String(quote.source ?? '').slice(0, 120) })),
    }
  } catch {
    return null
  }
}

// What the phone's Share button or the browser-bar button sends in.
export function readIncoming(search: string): { title: string; text: string; url: string } | null {
  const params = new URLSearchParams(search)
  const title = params.get('share-title') ?? params.get('title') ?? ''
  const text = params.get('share-text') ?? params.get('text') ?? ''
  const url = params.get('share-url') ?? params.get('url') ?? ''
  if (!params.has('share-title') && !params.has('share-text') && !params.has('share-url') && !params.has('text'))
    return null
  const link = url || text.match(/https?:\/\/\S+/)?.[0] || ''
  return {
    title: title.slice(0, 200),
    text: text.replace(link, '').trim().slice(0, 4000) || text.slice(0, 4000),
    url: link,
  }
}

// The address that opens a quick note, for the "Save to Noesis" button in the browser bar.
export function bookmarkletCode(origin: string): string {
  return `javascript:(function(){var s=String(window.getSelection()||'');window.open('${origin}/?share-title='+encodeURIComponent(document.title)+'&share-text='+encodeURIComponent(s)+'&share-url='+encodeURIComponent(location.href),'noesis','width=520,height=720');})();`
}
