// Lets Noesis open without a connection. The app's own files are kept after the first visit; anything
// that talks to a server (sign-in, AI, search, sync) always goes to the network.
const CACHE = 'noesis-app-v6'
const KEEP = 250

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name !== CACHE && name !== 'noesis-share-inbox') await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

async function trim(cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - KEEP))) await cache.delete(key)
}

// Shared into Noesis from another app (Android, computers). Books wait in a cache for the app to import them;
// shared words and links go on to the page as before.
async function takeShare(request) {
  const form = await request.formData().catch(() => null)
  const params = new URLSearchParams()
  if (form) {
    for (const key of ['share-title', 'share-text', 'share-url']) {
      const value = form.get(key)
      if (typeof value === 'string' && value) params.set(key, value)
    }
    const files = form.getAll('files').filter((file) => typeof file === 'object' && file.size > 0)
    if (files.length) {
      const inbox = await caches.open('noesis-share-inbox')
      await Promise.all(
        files.map((file, i) =>
          inbox.put(
            `/share-inbox/${Date.now()}-${i}`,
            new Response(file, {
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-name': encodeURIComponent(file.name || 'shared'),
              },
            }),
          ),
        ),
      )
    }
  }
  const query = params.toString()
  return Response.redirect(query ? `/?${query}` : '/', 303)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method === 'POST' && new URL(request.url).pathname === '/share') {
    event.respondWith(takeShare(request))
    return
  }
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
          // Noesis and Noesis Notes are two pages; each keeps its own copy for offline.
          const page = url.pathname.startsWith('/notes') ? '/notes/' : url.pathname === '/' ? '/' : ''
          if (page && fresh.ok && fresh.headers.get('content-type')?.includes('text/html')) {
            await cache.put(page, fresh.clone())
          }
          return fresh
        } catch {
          const page = url.pathname.startsWith('/notes') ? '/notes/' : '/'
          return (await cache.match(request)) || (await cache.match(page)) || Response.error()
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

// Review reminders with Noesis closed: the Worker sends an empty push when cards come due (see src/lib/reviewPush.ts).
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Noesis', {
      body: 'Review cards are ready.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'noesis-review',
      data: { url: '/?page=review' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client)
      if (open) {
        void open.navigate?.(url)
        return open.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
