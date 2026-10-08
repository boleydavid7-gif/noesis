// Inside the phone apps the pages come from the device, so requests to Noesis's own server
// (addresses beginning /api/) need the full web address of that server.

export const NOESIS_ORIGIN = 'https://noesis.proairetos.com'

export function isNativeApp(): boolean {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return Boolean(capacitor?.isNativePlatform?.())
}

export function withOrigin(input: RequestInfo | URL, origin = NOESIS_ORIGIN): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/api/')) return `${origin}${input}`
  return input
}

// Called once at start-up. Does nothing in a normal browser.
export function installNativeApi(): void {
  if (!isNativeApp()) return
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => original(withOrigin(input), init)
}
