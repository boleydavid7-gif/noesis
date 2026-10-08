// Runs the small on-device model away from the page, so searching never freezes it.
// The model code is loaded from a CDN when first needed, not bundled with the app.

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm'
const MODEL = 'Xenova/all-MiniLM-L6-v2'

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>

// This file runs in a worker, where `self` is not a window.
const scope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  onmessage: ((event: MessageEvent<{ id: number; texts: string[] }>) => void) | null
}

let extractor: Promise<Extractor> | null = null

function load(): Promise<Extractor> {
  extractor ??= (async () => {
    const lib = (await import(/* @vite-ignore */ LIBRARY)) as {
      pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<Extractor>
    }
    return lib.pipeline('feature-extraction', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event.status === 'progress' && typeof event.progress === 'number')
          scope.postMessage({ type: 'progress', percent: Math.round(event.progress) })
      },
    })
  })()
  extractor.catch(() => {
    extractor = null
  })
  return extractor
}

scope.onmessage = async (event) => {
  const { id, texts } = event.data
  try {
    const run = await load()
    const out = await run(texts, { pooling: 'mean', normalize: true })
    const dim = out.dims[1]
    const vectors = texts.map((_, index) => out.data.slice(index * dim, (index + 1) * dim))
    scope.postMessage(
      { type: 'vectors', id, vectors },
      vectors.map((vector) => vector.buffer),
    )
  } catch (error) {
    scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
