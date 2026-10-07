import { createClient, type AuthChangeEvent, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

let client: SupabaseClient | null = null

export function getAuthClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  }
  return client
}

export async function getCurrentSession(): Promise<Session | null> {
  const result = await getAuthClient().auth.getSession()
  if (result.error) throw new Error(result.error.message)
  return result.data.session
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const result = await getAuthClient().auth.signInWithPassword({ email, password })
  if (result.error || !result.data.session) throw new Error(result.error?.message ?? 'Could not sign in.')
  return result.data.session
}

export async function signUpWithPassword(email: string, password: string, displayName = ''): Promise<{ session: Session | null; user: User | null }> {
  const result = await getAuthClient().auth.signUp({ email, password, options: displayName.trim() ? { data: { full_name: displayName.trim() } } : undefined })
  if (result.error) throw new Error(result.error.message)
  return { session: result.data.session, user: result.data.user }
}

export async function upgradeAnonymousAccount(email: string, password: string, displayName = ''): Promise<Session | null> {
  const result = await getAuthClient().auth.updateUser({ email, password, data: displayName.trim() ? { full_name: displayName.trim() } : undefined })
  if (result.error) throw new Error(result.error.message)
  return (await getCurrentSession()) ?? (result.data.user ? null : null)
}

export async function updateProfileName(firstName: string): Promise<User> {
  const value = firstName.trim()
  const result = await getAuthClient().auth.updateUser({
    data: { first_name: value || null, given_name: value || null, full_name: value || null, name: value || null },
  })
  if (result.error || !result.data.user) throw new Error(result.error?.message ?? 'Could not save your name.')
  return result.data.user
}

export async function sendPasswordReset(email: string): Promise<void> {
  const result = await getAuthClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` })
  if (result.error) throw new Error(result.error.message)
}

export async function signOut(): Promise<void> {
  const result = await getAuthClient().auth.signOut()
  if (result.error) throw new Error(result.error.message)
}

export function subscribeToAuth(callback: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  const { data } = getAuthClient().auth.onAuthStateChange(callback)
  return () => data.subscription.unsubscribe()
}

export function isAnonymousUser(user: User | null): boolean {
  return Boolean(user?.is_anonymous)
}
