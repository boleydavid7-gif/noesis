// Small calculations for tap zones and automatic scrolling.

export type TapZone = 'up' | 'down' | null

// Tapping near the top of the page goes back a screen; near the bottom goes on.
export function tapZone(visibleY: number, height: number, edge = 0.22): TapZone {
  if (height <= 0 || visibleY < 0 || visibleY > height) return null
  const fraction = visibleY / height
  if (fraction < edge) return 'up'
  if (fraction > 1 - edge) return 'down'
  return null
}

// A screen's worth, less a few lines so the last line read stays in view.
export const pageScroll = (height: number) => Math.round(height * 0.88)

// Speed runs from 1 (slow) to 10 (fast), in pixels per second.
export const autoScrollPixelsPerSecond = (speed: number) => 14 * Math.max(1, Math.min(10, speed))
