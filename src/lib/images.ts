// The pictures behind the home banner and the sidebar. They are kept on this device only.

export type ImageSlot = 'banner' | 'sidebar'
export type ImageChoice = { slot: ImageSlot; value: string } // a preset name, or a picture saved as a data address

const KEY = 'noesis:images:v1'

// Pictures kept with the app: a wide one for the banner and a tall one for the sidebar.
export const SCENES: Array<{ id: string; label: string; banner: string; sidebar: string }> = [
  {
    id: 'city-night',
    label: 'City at night',
    banner: '/scenes/city-night-wide.webp',
    sidebar: '/scenes/city-night-tall.webp',
  },
  { id: 'cabin', label: 'Cabin at sunrise', banner: '/scenes/cabin-wide.webp', sidebar: '/scenes/cabin-tall.webp' },
  { id: 'forest', label: 'Forest stream', banner: '/scenes/forest-wide.webp', sidebar: '/scenes/forest-tall.webp' },
]

export const IMAGE_PRESETS: Array<{ id: string; label: string; css: string }> = [
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(135deg, #3b2a4d, #c1666b 62%, #f2b880)' },
  { id: 'ocean', label: 'Ocean', css: 'linear-gradient(135deg, #06283d, #1b6ca8 60%, #7fc4d6)' },
  { id: 'moss', label: 'Moss', css: 'linear-gradient(135deg, #0f2a1f, #2f6b4a 60%, #8bb77a)' },
  { id: 'ember', label: 'Ember', css: 'linear-gradient(135deg, #2a0f0a, #a8452a 62%, #f0a868)' },
  { id: 'ink', label: 'Ink', css: 'linear-gradient(135deg, #0b0f14, #1c2530 70%, #2d3b4a)' },
]

export type SavedImages = Partial<Record<ImageSlot, string>>

export function readImages(): SavedImages {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    const result: SavedImages = {}
    for (const slot of ['banner', 'sidebar'] as const) {
      const value = parsed[slot]
      if (typeof value === 'string' && value) result[slot] = value
    }
    return result
  } catch {
    return {}
  }
}

export function cssForImage(value: string, slot: ImageSlot = 'banner'): string | undefined {
  if (value.startsWith('data:image/')) return `url("${value}")`
  const scene = SCENES.find((item) => item.id === value)
  if (scene) return `url("${slot === 'sidebar' ? scene.sidebar : scene.banner}")`
  return IMAGE_PRESETS.find((preset) => preset.id === value)?.css
}

export function saveImage(slot: ImageSlot, value: string | null): boolean {
  const next = { ...readImages() }
  if (value) next[slot] = value
  else delete next[slot]
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

// Sets the page's picture variables from what is saved. Anything not saved keeps the built-in picture.
export function applyImages(root: HTMLElement = document.documentElement): void {
  const saved = readImages()
  for (const [slot, variable] of [
    ['banner', '--img-banner'],
    ['sidebar', '--img-sidebar'],
  ] as const) {
    const css = saved[slot] ? cssForImage(saved[slot], slot) : undefined
    if (css) root.style.setProperty(variable, css)
    else root.style.removeProperty(variable)
  }
}

// Shrinks a chosen photo so it fits in local storage.
export async function shrinkPicture(file: File, maxWidth = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxWidth / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not read that picture.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.8)
}
