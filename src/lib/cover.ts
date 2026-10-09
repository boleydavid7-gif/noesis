// Book covers are kept small: the library list lives in browser storage, which holds only a few megabytes.
const MAX_SIDE = 320
const SMALL_ENOUGH = 40_000

/** A reduced copy of a cover as a JPEG data URL, or the original when it is already small or cannot be reduced. */
export async function shrinkCover(dataUrl: string | undefined): Promise<string | undefined> {
  if (!dataUrl || dataUrl.length <= SMALL_ENOUGH || typeof document === 'undefined') return dataUrl
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('cover'))
      image.src = dataUrl
    })
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const smaller = canvas.toDataURL('image/jpeg', 0.8)
    return smaller.length < dataUrl.length ? smaller : dataUrl
  } catch {
    return dataUrl
  }
}
