// Web Push's VAPID signature, with nothing but Web Crypto, so the Worker can send a push itself: a short ES256 token
// naming the push service and who sends it. The push carries no words; the service worker says what it is.

const b64url = (bytes: Uint8Array) => {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (text: string) => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

/** The private key (32 bytes, base64url, as `web-push generate-vapid-keys` prints it) with its public key's x and y. */
export async function vapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = fromB64url(publicKey.trim())
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key is not an uncompressed P-256 key')
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: privateKey.trim(), x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/** The Authorization header for one push to `endpoint`, good for 12 hours. */
export async function vapidAuthorization(
  endpoint: string,
  key: CryptoKey,
  publicKey: string,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)),
  )
  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKey.trim()}`
}
