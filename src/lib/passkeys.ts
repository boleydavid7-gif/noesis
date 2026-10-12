// Passkeys: sign in with Face ID, a fingerprint or the device's PIN. The passkey belongs to this site and lives in
// the device's password manager; the account keeps only its public key (table `noesis_passkeys`), and the Worker
// checks a passkey's signature before making a one-time sign-in (`/api/passkey/*`).

import { fromBase64Url, toBase64Url } from './webauthn'
import { getAuthClient, getCurrentSession, isAnonymousUser } from './auth'

export class PasskeyCancelled extends Error {
  constructor() {
    super('The passkey was not used.')
    this.name = 'PasskeyCancelled'
  }
}

export function passkeysHere(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential === 'function'
}

export async function passkeyAutofillHere(): Promise<boolean> {
  if (!passkeysHere()) return false
  const check = (window.PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> })
    .isConditionalMediationAvailable
  return Boolean(await check?.().catch(() => false))
}

let serverReady: Promise<boolean> | null = null
/** Whether the Worker has passkeys set up (the service role secret). */
export function passkeysOnServer(): Promise<boolean> {
  serverReady ??= fetch('/api/config')
    .then((response) => (response.ok ? response.json() : {}))
    .then((config: { passkeys?: boolean }) => Boolean(config.passkeys))
    .catch(() => false)
  return serverReady
}

function asked<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((cause: unknown) => {
    if (cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'AbortError'))
      throw new PasskeyCancelled()
    if (cause instanceof DOMException && cause.name === 'InvalidStateError')
      throw new Error('This device already has a passkey for your account.')
    throw cause
  })
}

export function deviceLabel(agent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPhone/.test(agent)) return 'iPhone'
  if (/iPad/.test(agent)) return 'iPad'
  if (/Android/.test(agent)) return 'Android'
  if (/Macintosh/.test(agent)) return 'Mac'
  if (/Windows/.test(agent)) return 'Windows'
  return 'This device'
}

export type PasskeyRow = {
  credential_id: string
  label: string | null
  created_at: string
  last_used_at: string | null
}

export async function listPasskeys(): Promise<PasskeyRow[]> {
  const { data, error } = await getAuthClient()
    .from('noesis_passkeys')
    .select('credential_id, label, created_at, last_used_at')
    .order('created_at')
  if (error)
    throw new Error(
      /relation|schema cache/.test(error.message) ? 'Passkeys are not set up on the server yet.' : error.message,
    )
  return (data ?? []) as PasskeyRow[]
}

export async function removePasskey(id: string): Promise<void> {
  const { error } = await getAuthClient().from('noesis_passkeys').delete().eq('credential_id', id)
  if (error) throw new Error(error.message)
}

/** Makes a passkey on this device for the signed-in learner. Call it straight from a tap (Safari needs that). */
export async function addPasskey(exclude: readonly string[]): Promise<void> {
  const session = await getCurrentSession()
  const user = session?.user
  if (!user || isAnonymousUser(user) || !user.email) throw new Error('Sign in with your email first.')
  const credential = (await asked(
    navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: 'Noesis' },
        user: { id: new TextEncoder().encode(user.id), name: user.email, displayName: user.email },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: exclude.map((id) => ({ type: 'public-key' as const, id: fromBase64Url(id) })),
      },
    }),
  )) as PublicKeyCredential | null
  if (!credential) throw new PasskeyCancelled()
  const response = credential.response as AuthenticatorAttestationResponse
  const publicKey = response.getPublicKey?.()
  const algorithm = response.getPublicKeyAlgorithm?.()
  if (!publicKey || (algorithm !== -7 && algorithm !== -257))
    throw new Error('This device made a passkey of a kind Noesis cannot use.')
  const { error } = await getAuthClient()
    .from('noesis_passkeys')
    .insert({
      credential_id: toBase64Url(new Uint8Array(credential.rawId)),
      user_id: user.id,
      public_key: toBase64Url(new Uint8Array(publicKey)),
      algorithm,
      rp_id: location.hostname,
      label: deviceLabel(),
    })
  if (error)
    throw new Error(
      /relation|schema cache/.test(error.message) ? 'Passkeys are not set up on the server yet.' : error.message,
    )
}

/** A sign-in challenge from the Worker, fetched before the tap. */
export async function passkeyChallenge(): Promise<string> {
  const response = await fetch('/api/passkey/begin', { method: 'POST' })
  const body = (await response.json().catch(() => ({}))) as { challenge?: string; error?: string }
  if (!response.ok || !body.challenge) throw new Error(body.error ?? 'Passkeys are not set up on the server yet.')
  return body.challenge
}

/** Signs in with a passkey (asked outright, or picked from the keyboard's suggestions when `conditional`). */
export async function signInWithPasskey(
  challenge: string,
  options: { conditional?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const credential = (await asked(
    navigator.credentials.get({
      ...(options.conditional ? { mediation: 'conditional' as CredentialMediationRequirement } : {}),
      signal: options.signal,
      publicKey: { rpId: location.hostname, challenge: fromBase64Url(challenge), userVerification: 'required' },
    }),
  )) as PublicKeyCredential | null
  if (!credential) throw new PasskeyCancelled()
  const response = credential.response as AuthenticatorAssertionResponse
  const finish = await fetch('/api/passkey/finish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      credentialId: toBase64Url(new Uint8Array(credential.rawId)),
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      signature: toBase64Url(new Uint8Array(response.signature)),
    }),
  })
  const body = (await finish.json().catch(() => ({}))) as { token_hash?: string; error?: string }
  if (!finish.ok || !body.token_hash) throw new Error(body.error ?? 'That passkey did not sign in.')
  const { error } = await getAuthClient().auth.verifyOtp({ token_hash: body.token_hash, type: 'magiclink' })
  if (error) throw new Error('That passkey did not sign in. Try again, or sign in with your email.')
}
