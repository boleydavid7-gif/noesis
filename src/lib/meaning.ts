import { embedOnDevice } from './embeddings'
import type { MeaningSearch } from './librarySearch'
import { loadVectors, saveVectors } from './vectorStore'

const BATCH = 16

// Finds passages by meaning using the model on the device. A book's vectors are made once and kept.
export const onDeviceMeaning: MeaningSearch = {
  embed: embedOnDevice,
  async vectorsFor(bookId, passages, onProgress) {
    const saved = await loadVectors(bookId, passages.length)
    if (saved) return saved
    const vectors: Float32Array[] = []
    for (let start = 0; start < passages.length; start += BATCH) {
      vectors.push(...(await embedOnDevice(passages.slice(start, start + BATCH))))
      onProgress?.(Math.min(start + BATCH, passages.length), passages.length)
    }
    await saveVectors(bookId, vectors)
    return vectors
  },
}
