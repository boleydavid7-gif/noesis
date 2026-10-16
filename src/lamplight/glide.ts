import { useEffect, useLayoutEffect, type RefObject } from 'react'

/*
 * Noesis's motion between places, the premium cut of Lamplight 1.3.
 *
 * One light marks where you are, in the dock and in the sidebar, and it travels: when the place changes it slides
 * to the new one on a lively spring instead of jumping (`useGlide`). Pages slide in the direction of travel
 * (`pageDirection`, read by `moveTo`). On phones the top bar is clear over the page and takes its mica once the page
 * scrolls, its large title settling into the bar; the dock steps aside while reading down and comes back on the way
 * up (`useScrollBars`). A scroll frame reads only the scroll position.
 */

/** Places a `.nx-glide` light under the host's current item, and moves it whenever `key` or the host's size changes. */
export function useGlide(host: RefObject<HTMLElement | null>, active: string, key: unknown): void {
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const place = () => {
      const on = element.querySelector<HTMLElement>(active)
      const style = element.style
      if (!on || !on.offsetWidth) {
        style.setProperty('--glide-on', '0')
        return
      }
      style.setProperty('--glide-x', `${on.offsetLeft}px`)
      style.setProperty('--glide-y', `${on.offsetTop}px`)
      style.setProperty('--glide-w', `${on.offsetWidth}px`)
      style.setProperty('--glide-h', `${on.offsetHeight}px`)
      style.setProperty('--glide-on', '1')
    }
    place()
    // The first placing happens without motion; from then on the light travels.
    const frame = requestAnimationFrame(() => element.classList.add('nx-glide-ready'))
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    resize?.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      resize?.disconnect()
    }
  }, [host, active, key])
}

/** The order of places, so a page can slide in from the side it lies on. */
const ORDER = ['Home', 'My Library', 'Read', 'Notes', 'Review', 'Learning Paths', 'Explore', 'Settings']

export type Direction = 'forward' | 'back'

export function pageDirection(from: string, to: string): Direction | undefined {
  const a = ORDER.indexOf(from)
  const b = ORDER.indexOf(to)
  if (a < 0 || b < 0 || a === b) return undefined
  return b > a ? 'forward' : 'back'
}

const PHONE = '(max-width: 900px)'

/** Phone bars that answer the scroll: the top bar's mica and settled title, and the dock stepping aside. */
export function useScrollBars(): void {
  useEffect(() => {
    const root = document.documentElement
    const phone = window.matchMedia?.(PHONE)
    let frame = 0
    let lastY = window.scrollY
    let tucked = false
    const update = () => {
      frame = 0
      const y = window.scrollY
      const room = document.documentElement.scrollHeight - window.innerHeight
      root.classList.toggle('nx-scrolled', y > 24)
      if (!phone?.matches || y < 80 || y > room - 40) tucked = false
      else if (y - lastY > 8) tucked = true
      else if (lastY - y > 8) tucked = false
      if (Math.abs(y - lastY) > 8 || y < 80) lastY = y
      root.classList.toggle('nx-tucked', tucked)
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', soon, { passive: true })
    window.addEventListener('resize', soon)
    update()
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', soon)
      window.removeEventListener('resize', soon)
      root.classList.remove('nx-scrolled', 'nx-tucked')
    }
  }, [])
}
