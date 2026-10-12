// Small things the device can do for a reader: keep the screen on while reading, show what is being read
// aloud on the lock screen, and give a light tap under the finger. Each does nothing where it is not offered.

import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

type Sentinel = { release: () => Promise<void> }
type WakeLock = { request: (type: 'screen') => Promise<Sentinel> }

/** Keeps the screen from dimming while `on`; asked again when the page comes back. */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    const wake = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock
    if (!on || !wake) return
    let held: Sentinel | undefined
    let done = false
    const hold = () =>
      void wake
        .request('screen')
        .then((sentinel) => {
          if (done) void sentinel.release().catch(() => undefined)
          else held = sentinel
        })
        .catch(() => undefined)
    hold()
    const again = () => document.visibilityState === 'visible' && hold()
    document.addEventListener('visibilitychange', again)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', again)
      void held?.release().catch(() => undefined)
    }
  }, [on])
}

export type NowPlaying = {
  title: string
  artist: string
  album?: string
  artwork?: string
  playing: boolean
  onPlayPause: () => void
  onNext?: () => void
  onPrevious?: () => void
  onStop?: () => void
}

/**
 * The lock screen and the phone's media controls while Listen reads: the chapter, the book, play and pause,
 * next and previous chapter. Handlers are read fresh each time, so the caller can pass new closures freely.
 */
export function useNowPlaying(now: NowPlaying | null): void {
  const latest = useRef(now)
  latest.current = now
  const key = now ? `${now.title}|${now.artist}|${now.artwork ?? ''}|${now.playing}` : ''
  useEffect(() => {
    const media = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : undefined
    if (!media || !latest.current) return
    const current = latest.current
    try {
      media.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album ?? 'Noesis',
        artwork: current.artwork
          ? [{ src: current.artwork }]
          : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      })
      media.playbackState = current.playing ? 'playing' : 'paused'
      media.setActionHandler('play', () => latest.current?.onPlayPause())
      media.setActionHandler('pause', () => latest.current?.onPlayPause())
      media.setActionHandler('nexttrack', current.onNext ? () => latest.current?.onNext?.() : null)
      media.setActionHandler('previoustrack', current.onPrevious ? () => latest.current?.onPrevious?.() : null)
      media.setActionHandler('stop', current.onStop ? () => latest.current?.onStop?.() : null)
    } catch {
      // Not every browser shows media controls.
    }
    return () => {
      try {
        for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'] as MediaSessionAction[])
          media.setActionHandler(action, null)
        media.metadata = null
      } catch {
        // Nothing was set.
      }
    }
  }, [key])
}

let hidden: HTMLLabelElement | undefined

/**
 * A light tap under the finger: vibrate() on Android; on iPhone (iOS 18+), where the web has no vibrate(),
 * flipping a hidden native switch gives Safari's own tap.
 */
export function tap(ms = 8): void {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms)
      return
    }
    if (typeof document === 'undefined') return
    if (!hidden) {
      const label = document.createElement('label')
      label.setAttribute('aria-hidden', 'true')
      label.style.cssText =
        'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-10px;top:-10px'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.tabIndex = -1
      label.appendChild(input)
      document.body.appendChild(label)
      hidden = label
    }
    hidden.click()
  } catch {
    // A nicety only.
  }
}

/** Runs `work` while holding a lock shared by every Noesis tab and window, so two never sync at once. */
export function oneAtATime<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return work()
  return locks.request(name, () => work()) as Promise<T>
}

/**
 * Changes the page inside a view transition, so the old page cross-fades into the new one (Safari 18+, Chrome).
 * Without support, or with motion turned down (the phone's setting or Noesis's own), it changes at once.
 */
export function moveTo(change: () => void): void {
  const start = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition
  const still =
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!start || still || document.visibilityState !== 'visible') {
    change()
    return
  }
  try {
    start.call(document, () => flushSync(change))
  } catch {
    change()
  }
}
