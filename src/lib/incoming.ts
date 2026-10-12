// Books that arrive from outside Noesis: opened with it on a computer (File Handling, Chrome and Edge), or shared
// into it from another app on Android or a computer (the service worker keeps them on the way in). Either way
// they wait here until the app takes them, then go through the ordinary import.

type LaunchQueue = {
  setConsumer: (consumer: (params: { files?: readonly { getFile: () => Promise<File> }[] }) => void) => void
}

const INBOX = 'noesis-share-inbox'
let waiting: File[] = []
let take: ((files: File[]) => void) | null = null

function arrive(files: File[]): void {
  if (!files.length) return
  if (take) take(files)
  else waiting = [...waiting, ...files]
}

async function sharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return []
  try {
    const cache = await caches.open(INBOX)
    const files: File[] = []
    for (const request of await cache.keys()) {
      const response = await cache.match(request)
      if (response) {
        const name = decodeURIComponent(response.headers.get('x-name') ?? 'shared')
        files.push(new File([await response.blob()], name, { type: response.headers.get('content-type') ?? '' }))
      }
      await cache.delete(request)
    }
    return files
  } catch {
    return []
  }
}

/** Called once at start, before the app draws, so the browser's launch files are caught. */
export function startIncoming(): void {
  void sharedFiles().then(arrive)
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer((params) => {
    if (params.files?.length) void Promise.all(params.files.map((handle) => handle.getFile())).then(arrive)
  })
}

/** The app takes incoming books from here on (and any that came before it was ready). */
export function onIncoming(handler: (files: File[]) => void): () => void {
  take = handler
  if (waiting.length) {
    const now = waiting
    waiting = []
    handler(now)
  }
  return () => {
    if (take === handler) take = null
  }
}
