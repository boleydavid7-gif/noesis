import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// Reading scanned PDF pages (Tesseract, on the device) needs its worker, its WebAssembly core and the English data
// from this site: served from node_modules while developing and copied into dist/ocr/ by a build.
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
}
const ocrFiles = () => ({
  name: 'ocr-files',
  configureServer(server: {
    middlewares: {
      use: (
        handler: (
          req: { url?: string },
          res: NodeJS.WritableStream & { setHeader: (k: string, v: string) => void },
          next: () => void,
        ) => void,
      ) => void
    }
  }) {
    server.middlewares.use((req, res, next) => {
      const name = req.url?.match(/^\/ocr\/([^?]+)/)?.[1]
      const file = name && OCR_FILES[name]
      if (!file) return next()
      res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
      createReadStream(file).pipe(res)
    })
  },
  closeBundle() {
    if (!existsSync('dist')) return
    mkdirSync('dist/ocr', { recursive: true })
    for (const [name, file] of Object.entries(OCR_FILES)) copyFileSync(file, `dist/ocr/${name}`)
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ocrFiles()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
})
