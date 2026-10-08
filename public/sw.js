// Lets Noesis open without a connection. The app's own files are kept after the first visit; anything
// that talks to a server (sign-in, AI, search, sync) always goes to the network.
const CACHE = 'noesis-app-v1'
const KEEP = 250

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

async function trim(cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - KEEP))) await cache.delete(key)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return

  // Pages: the network first so updates arrive, the saved copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          const fresh = await fetch(request)
          if (fresh.ok && fresh.headers.get('content-type')?.includes('text/html') && url.pathname === '/') {
            await cache.put('/', fresh.clone())
          }
          return fresh
        } catch {
          return (await cache.match(request)) || (await cache.match('/')) || Response.error()
        }
      })(),
    )
    return
  }

  // Scripts, styles, images, sounds: saved the first time, then served from the saved copy.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const saved = await cache.match(request)
      const refresh = fetch(request)
        .then(async (response) => {
          if (
            response.ok &&
            response.type === 'basic' &&
            !response.headers.get('content-type')?.includes('text/html')
          ) {
            await cache.put(request, response.clone())
            void trim(cache)
          }
          return response
        })
        .catch(() => undefined)
      if (saved) {
        void refresh
        return saved
      }
      return (await refresh) || Response.error()
    })(),
  )
})
