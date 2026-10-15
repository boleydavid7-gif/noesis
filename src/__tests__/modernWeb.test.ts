import { describe, expect, it } from 'vitest'
import { checkAssertion, derToRaw, toBase64Url } from '../lib/webauthn'
import { vapidAuthorization, vapidKey } from '../lib/vapid'
import { deviceLabel } from '../lib/passkeys'

const enc = new TextEncoder()

function rawToDer(raw: Uint8Array): Uint8Array {
  const part = (bytes: Uint8Array) => {
    let at = 0
    while (at < bytes.length - 1 && bytes[at] === 0) at += 1
    let value = bytes.slice(at)
    if (value[0] & 0x80) value = Uint8Array.from([0, ...value])
    return Uint8Array.from([0x02, value.length, ...value])
  }
  const body = Uint8Array.from([...part(raw.slice(0, 32)), ...part(raw.slice(32))])
  return Uint8Array.from([0x30, body.length, ...body])
}

async function signed(
  keys: CryptoKeyPair,
  { challenge = 'abc', origin = 'https://noesis.app', rpId = 'noesis.app', flags = 0x05 } = {},
) {
  const clientData = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge, origin }))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(rpId)))
  const auth = Uint8Array.from([...hash, flags, 0, 0, 0, 0])
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData))
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      Uint8Array.from([...auth, ...clientHash]),
    ),
  )
  return {
    clientDataJSON: toBase64Url(clientData),
    authenticatorData: toBase64Url(auth),
    signature: toBase64Url(rawToDer(raw)),
  }
}

const ecKeys = () =>
  crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>
const spki = async (keys: CryptoKeyPair) =>
  toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)))

describe('passkey sign-in', () => {
  it('accepts a verified signature for the challenge and site, and refuses anything else', async () => {
    const keys = await ecKeys()
    const passkey = { publicKey: await spki(keys), algorithm: -7, rpId: 'noesis.app' }
    expect(await checkAssertion(await signed(keys), passkey, 'abc')).toBe('')
    expect(await checkAssertion(await signed(keys), passkey, 'other')).toBe('challenge')
    expect(await checkAssertion(await signed(keys, { origin: 'https://evil.example' }), passkey, 'abc')).toBe('origin')
    expect(await checkAssertion(await signed(keys, { flags: 0x01 }), passkey, 'abc')).toBe('not verified')
    expect(await checkAssertion(await signed(await ecKeys()), passkey, 'abc')).toBe('signature')
  })

  it('reads DER signatures and names devices', () => {
    const raw = new Uint8Array(64).map((_, i) => (i === 0 ? 0 : i === 32 ? 0x90 : i))
    expect([...derToRaw(rawToDer(raw))]).toEqual([...raw])
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone')
  })
})

describe('review reminders', () => {
  it('signs a VAPID token the push service can check with the public key', async () => {
    const keys = await ecKeys()
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey)
    const publicKey = toBase64Url(pub)
    const key = await vapidKey(publicKey, jwk.d as string)
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      key,
      publicKey,
      'mailto:me@example.com',
      1_700_000_000_000,
    )
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? []
    expect(k).toBe(publicKey)
    const [head, body, signature] = token.split('.')
    const claims = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.exp).toBe(1_700_000_000 + 12 * 3600)
    const sig = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (signature.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    )
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        keys.publicKey,
        sig,
        enc.encode(`${head}.${body}`),
      ),
    ).toBe(true)
  })
})

describe('books that arrive from outside', () => {
  it('wait until the app takes them, then go straight to it', async () => {
    const { onIncoming, startIncoming } = await import('../lib/incoming')
    let consumer: ((params: { files: { getFile: () => Promise<File> }[] }) => void) | undefined
    ;(globalThis as unknown as { window: unknown }).window = {
      launchQueue: { setConsumer: (fn: typeof consumer) => (consumer = fn) },
    }
    startIncoming()
    consumer?.({ files: [{ getFile: async () => new File(['a'], 'Early.epub') }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const taken: string[] = []
    const stop = onIncoming((files) => taken.push(...files.map((file) => file.name)))
    expect(taken).toEqual(['Early.epub'])
    consumer?.({ files: [{ getFile: async () => new File(['b'], 'Later.pdf') }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(taken).toEqual(['Early.epub', 'Later.pdf'])
    stop()
  })
})
