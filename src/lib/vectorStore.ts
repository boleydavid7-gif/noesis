// Remembers the vectors made for each book so a book is only read by the model once.

const DB = 'noesis-vectors'
const STORE = 'vectors'

type Saved = { chunks: number; dim: number; data: Float32Array }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No storage.'))
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open storage.'))
  })
}

export async function loadVectors(id: string, chunks: number): Promise<Float32Array[] | null> {
  try {
    const db = await open()
    const saved = await new Promise<Saved | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      request.onsuccess = () => resolve(request.result as Saved | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    if (!saved || saved.chunks !== chunks) return null
    return Array.from({ length: chunks }, (_, index) => saved.data.subarray(index * saved.dim, (index + 1) * saved.dim))
  } catch {
    return null
  }
}

export async function saveVectors(id: string, vectors: Float32Array[]): Promise<void> {
  if (vectors.length === 0) return
  try {
    const dim = vectors[0].length
    const data = new Float32Array(vectors.length * dim)
    vectors.forEach((vector, index) => data.set(vector, index * dim))
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put({ chunks: vectors.length, dim, data } satisfies Saved, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  } catch {
    // The vectors are rebuilt next time.
  }
}

export async function deleteVectors(id: string): Promise<void> {
  try {
    const db = await open()
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
    db.close()
  } catch {
    // Nothing to clean up.
  }
}
