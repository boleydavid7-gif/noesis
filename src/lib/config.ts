// These are public Supabase browser values. The publishable key is designed to
// be used in a browser; the Gemini secret never belongs here.
const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const configuredKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const SUPABASE_URL = configuredUrl || 'https://dbcvziimlumlqpehgapi.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = configuredKey || 'sb_publishable_FPe82WH-6DgriZj9e0FwJA_2ehBLYuV'
