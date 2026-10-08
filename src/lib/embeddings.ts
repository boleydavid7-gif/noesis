import type { Embed } from './semantic'

// The on-device embedding model, run in a worker. It downloads about 25 MB the first time and is
// then kept by the browser. Anything that goes wrong simply turns the feature off for the session.

export type EmbedStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; percent?: number }

let worker: Worker | null = null
let nextId = 1
let status: EmbedStatus = { state: 'idle' }
const pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>()
const listeners = new Set<(status: EmbedStatus) => void>()

const publish = (next: EmbedStatus) => {
  status = next
  for (const listener of listeners) listener(next)
}

export const canEmbedOnDevice = () =>
  typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof window !== 'undefined'

export function watchEmbedStatus(listener: (status: EmbedStatus) => void): () => void {
  listeners.add(listener)
  listener(status)
  return () => listeners.delete(listener)
}

function start(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./embedWorker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent) => {
    const message = event.data as
      | { type: 'progress'; percent: number }
      | { type: 'vectors'; id: number; vectors: Float32Array[] }
      | { type: 'error'; id: number; message: string }
    if (message.type === 'progress') {
      publish({ state: 'loading', percent: message.percent })
      return
    }
    const waiting = pending.get(message.id)
    pending.delete(message.id)
    if (message.type === 'vectors') {
      publish({ state: 'ready' })
      waiting?.resolve(message.vectors)
    } else {
      publish({ state: 'error' })
      waiting?.reject(new Error(message.message))
    }
  }
  created.onerror = () => {
    publish({ state: 'error' })
    for (const waiting of pending.values()) waiting.reject(new Error('The on-device model could not start.'))
    pending.clear()
    created.terminate()
    worker = null
  }
  worker = created
  return created
}

export const embedOnDevice: Embed = (texts) => {
  if (!canEmbedOnDevice()) return Promise.reject(new Error('This browser cannot run the on-device model.'))
  if (status.state === 'idle' || status.state === 'error') publish({ state: 'loading' })
  return new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1
    pending.set(id, { resolve, reject })
    start().postMessage({ id, texts })
  })
}
