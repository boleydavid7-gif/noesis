// Lamplight, copied from Proairetos (src/lamplight/color.ts); change it there first and copy it here, so the two stay one system.
/** Color math for Lamplight: OKLCH to sRGB (chroma lowered until it fits), and WCAG contrast. No DOM. */

export type Hex = `#${string}`

function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const fits = (rgb: number[]) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4)
const encode = (x: number) => {
  const v = Math.min(Math.max(x, 0), 1)
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/** A color from lightness (0-1), chroma and hue; chroma is lowered in small steps until it is a real sRGB color. */
export function oklch(L: number, C: number, h: number): Hex {
  let chroma = C
  let rgb = oklchToLinear(L, chroma, h)
  while (chroma > 0 && !fits(rgb)) {
    chroma -= 0.002
    rgb = oklchToLinear(L, Math.max(chroma, 0), h)
  }
  return `#${rgb
    .map((x) =>
      Math.round(encode(x) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}` as Hex
}

export const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]

/** "r, g, b" for rgba(var(--x-rgb), a). */
export const triple = (hex: string) => channels(hex).join(', ')

export const rgba = (hex: string, alpha: number) => `rgba(${triple(hex)}, ${alpha})`

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The OKLCH lightness, chroma and hue of a color (for taking a seed from an existing color). */
export function toOklch(hex: string): { L: number; C: number; h: number } {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { L, C: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}
