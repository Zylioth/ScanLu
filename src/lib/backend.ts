import type { Backend } from './types'
import { localBackend } from './localBackend'

/**
 * One switch for the whole app. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * to move from the seeded local demo to a real deployment; see README.md.
 */
const hasSupabase = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
)

let instance: Backend = localBackend
let loaded = false

export async function getBackend(): Promise<Backend> {
  if (!hasSupabase) return localBackend
  if (!loaded) {
    // Code-split: the guest route should not carry the Supabase client.
    const mod = await import('./supabaseBackend')
    instance = mod.supabaseBackend
    loaded = true
  }
  return instance
}

export const isDemoMode = !hasSupabase
