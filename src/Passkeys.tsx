// Passkeys on the Account page: sign in with Face ID, a fingerprint or the device's PIN; add one, see them, remove
// one. Safari lets a passkey be made or used only straight after a tap, so the server is asked beforehand.

import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import {
  PasskeyCancelled,
  addPasskey,
  listPasskeys,
  passkeyAutofillHere,
  passkeyChallenge,
  passkeysHere,
  passkeysOnServer,
  removePasskey,
  signInWithPasskey,
  type PasskeyRow,
} from './lib/passkeys'

const CHALLENGE_MS = 90_000
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'That did not work. Try again.')

function useServerPasskeys(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (passkeysHere()) void passkeysOnServer().then(setReady)
  }, [])
  return ready
}

let autofill: AbortController | null = null
const stopAutofill = () => {
  autofill?.abort()
  autofill = null
}

/** Signed out: "Sign in with a passkey", and passkeys offered in the email field's suggestions. */
export function PasskeySignIn({ onSignedIn, onNotice }: { onSignedIn: () => void; onNotice: (text: string) => void }) {
  const ready = useServerPasskeys()
  const challenge = useRef<{ value: string; at: number } | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const latest = useRef({ onSignedIn, onNotice })
  latest.current = { onSignedIn, onNotice }

  useEffect(() => {
    if (!ready) return
    let stopped = false
    const fetchOne = () =>
      void passkeyChallenge()
        .then((value) => {
          if (!stopped) challenge.current = { value, at: Date.now() }
        })
        .catch(() => undefined)
    // The keyboard's suggestions: picking a passkey there signs in like the button.
    const arm = () =>
      void passkeyAutofillHere().then(async (here) => {
        if (!here || stopped) return
        stopAutofill()
        const controller = new AbortController()
        autofill = controller
        const value = await passkeyChallenge().catch(() => undefined)
        if (!value || controller.signal.aborted) return
        try {
          await signInWithPasskey(value, { conditional: true, signal: controller.signal })
          latest.current.onSignedIn()
        } catch (cause) {
          if (!(cause instanceof PasskeyCancelled) && !stopped) latest.current.onNotice(message(cause))
        }
      })
    fetchOne()
    arm()
    const timer = window.setInterval(() => {
      fetchOne()
      arm()
    }, CHALLENGE_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
      stopAutofill()
    }
  }, [ready])

  if (!ready) return null
  return (
    <button
      type="button"
      className="secondary-button passkey-button"
      disabled={busy}
      onClick={() => {
        stopAutofill()
        setBusy(true)
        const fresh =
          challenge.current && Date.now() - challenge.current.at < CHALLENGE_MS + 20_000
            ? challenge.current.value
            : undefined
        challenge.current = undefined
        void (fresh ? Promise.resolve(fresh) : passkeyChallenge())
          .then((value) => signInWithPasskey(value))
          .then(() => onSignedIn())
          .catch((cause: unknown) => {
            if (!(cause instanceof PasskeyCancelled)) onNotice(message(cause))
          })
          .finally(() => setBusy(false))
      }}
    >
      <KeyRound size={15} /> {busy ? 'Signing in…' : 'Sign in with a passkey'}
    </button>
  )
}

/** Signed in: this account's passkeys, Add a passkey, Remove. */
export function PasskeysPanel({ onNotice }: { onNotice: (text: string) => void }) {
  const ready = useServerPasskeys()
  const [rows, setRows] = useState<PasskeyRow[]>()
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () =>
    listPasskeys().then(
      (found) => (setRows(found), setProblem('')),
      (cause: unknown) => setProblem(message(cause)),
    )
  useEffect(() => {
    if (ready) void load()
  }, [ready])
  if (!ready) return null
  const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
  return (
    <section className="panel-card passkeys-panel" aria-label="Passkeys">
      <h3>
        <KeyRound size={16} /> Passkeys
      </h3>
      <p className="passkeys-detail">Sign in with Face ID, a fingerprint or your device PIN.</p>
      {problem ? <p className="passkeys-detail">{problem}</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="passkeys-list">
          {rows.map((row) => (
            <li key={row.credential_id}>
              <span>
                {row.label ?? 'Passkey'}
                <small>
                  Added {day(row.created_at)}
                  {row.last_used_at ? ` · used ${day(row.last_used_at)}` : ''}
                </small>
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  void removePasskey(row.credential_id).then(
                    () => {
                      void load()
                      onNotice('Passkey removed. You can still delete it from the device’s password manager.')
                    },
                    (cause: unknown) => onNotice(message(cause)),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!problem ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void addPasskey((rows ?? []).map((row) => row.credential_id))
              .then(() => {
                onNotice('Passkey added.')
                return load()
              })
              .catch((cause: unknown) => {
                if (!(cause instanceof PasskeyCancelled)) onNotice(message(cause))
              })
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Adding…' : 'Add a passkey'}
        </button>
      ) : null}
    </section>
  )
}
