// Reading the text of a scanned page, on the device (Tesseract, WebAssembly). The worker, its core and the English
// data are served from this site (`/ocr/`, copied there by the build); the page never leaves the device.

type Worker = { recognize: (image: Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> }

let worker: Promise<Worker> | null = null
let progress: ((share: number) => void) | undefined

function start(): Promise<Worker> {
  worker ??= import('tesseract.js')
    .then(
      ({ createWorker }) =>
        createWorker('eng', 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr',
          langPath: '/ocr',
          workerBlobURL: false,
          logger: (message: { status: string; progress: number }) => {
            if (message.status === 'recognizing text') progress?.(message.progress)
          },
        }) as unknown as Promise<Worker>,
    )
    .catch((cause) => {
      worker = null
      throw cause
    })
  return worker
}

/** An image made small enough to read quickly (2000 px on the long side), in grey. */
async function prepared(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.filter = 'grayscale(1) contrast(1.3)'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), 'image/png'))
  } catch {
    return file
  }
}

export async function readImageText(file: Blob, onProgress?: (share: number) => void): Promise<string> {
  progress = onProgress
  try {
    const reader = await start()
    const { data } = await reader.recognize(await prepared(file))
    return data.text
  } finally {
    progress = undefined
  }
}
