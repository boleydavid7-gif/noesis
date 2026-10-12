// Checks a passkey's answer (a WebAuthn assertion) with nothing but Web Crypto, so the same code runs in the
// Worker (`/api/passkey/finish`) and in the tests. Only what this account needs: ES256 and RS256 keys, a challenge the
// server made, the site the passkey belongs to, and the person present and verified (Face ID, fingerprint, PIN).

export type StoredPasskey = {
  /** SubjectPublicKeyInfo (DER), base64url, as the browser gave it at registration. */
  publicKey: string
  /** COSE algorithm: -7 ES256, -257 RS256. */
  algorithm: number
  /** The site the passkey was made for ("proairetos.com"). */
  rpId: string
}

export type Assertion = {
  clientDataJSON: string
  authenticatorData: string
  signature: string
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export function toBase64Url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])

/** An ECDSA signature arrives DER-encoded; Web Crypto wants r and s side by side, 32 bytes each. */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error('signature')
  let at = 2
  if (der[1] & 0x80) at = 2 + (der[1] & 0x7f)
  const part = () => {
    if (der[at] !== 0x02) throw new Error('signature')
    const length = der[at + 1]
    let value = der.slice(at + 2, at + 2 + length)
    at += 2 + length
    while (value.length > 32 && value[0] === 0) value = value.slice(1)
    if (value.length > 32) throw new Error('signature')
    const out = new Uint8Array(32)
    out.set(value, 32 - value.length)
    return out
  }
  const r = part()
  const s = part()
  const raw = new Uint8Array(64)
  raw.set(r, 0)
  raw.set(s, 32)
  return raw
}

/** The origins a passkey for this site may answer from: the site itself, or a local test server. */
function originFits(origin: string, rpId: string): boolean {
  try {
    const url = new URL(origin)
    if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) return false
    return url.protocol === 'https:' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * Whether the assertion answers this challenge, for this site, signed by this passkey, with the person verified.
 * Returns the reason when it does not ("" when it does), so the function can log it without telling a caller why.
 */
export async function checkAssertion(assertion: Assertion, passkey: StoredPasskey, challenge: string): Promise<string> {
  let client: { type?: string; challenge?: string; origin?: string }
  const clientBytes = fromBase64Url(assertion.clientDataJSON)
  try {
    client = JSON.parse(new TextDecoder().decode(clientBytes))
  } catch {
    return 'client data'
  }
  if (client.type !== 'webauthn.get') return 'type'
  if (client.challenge !== challenge) return 'challenge'
  if (!client.origin || !originFits(client.origin, passkey.rpId)) return 'origin'

  const auth = fromBase64Url(assertion.authenticatorData)
  if (auth.length < 37) return 'authenticator data'
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passkey.rpId)))
  if (!same(auth.slice(0, 32), rpHash)) return 'site'
  const flags = auth[32]
  if (!(flags & 0x01)) return 'not present'
  if (!(flags & 0x04)) return 'not verified'

  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientBytes))
  const signed = new Uint8Array(auth.length + clientHash.length)
  signed.set(auth, 0)
  signed.set(clientHash, auth.length)
  const signature = fromBase64Url(assertion.signature)
  const spki = fromBase64Url(passkey.publicKey)
  try {
    if (passkey.algorithm === -7) {
      const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      return (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), signed))
        ? ''
        : 'signature'
    }
    if (passkey.algorithm === -257) {
      const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
        'verify',
      ])
      return (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)) ? '' : 'signature'
    }
  } catch {
    return 'key'
  }
  return 'algorithm'
}
