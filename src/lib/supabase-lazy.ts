/**
 * Lazy Supabase client for route handlers.
 *
 * Why: Vercel preview builds don't inherit Production-scope env vars, so
 * calling createClient() at route-module top-level throws "supabaseUrl is
 * required" during Next.js' page-data collection step, failing the build.
 * This module exposes a Proxy that defers createClient() until the first
 * property access (first request on Production, where env vars exist).
 *
 * Usage: `import { supabase } from '@/lib/supabase-lazy'` — drops in as a
 * replacement for the local `const supabase = createClient(url!, key!)`
 * pattern without changing any call sites.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdminKey, getSupabaseUrl } from '@/lib/supabase/env'

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    getSupabaseUrl(),
    getSupabaseAdminKey(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  return _client
}

// Proxy that lazy-resolves every property access to the real client. Functions
// returned by property access are rebound to the client so their `this`
// references stay correct (e.g., chained `.from().select()` calls).
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getClient()
    const val = (c as unknown as Record<PropertyKey, unknown>)[prop]
    return typeof val === 'function' ? val.bind(c) : val
  },
})
