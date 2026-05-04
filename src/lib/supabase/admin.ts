import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdminKey, getSupabaseUrl } from '@/lib/supabase/env'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: SupabaseClient<any, 'public', any> | null = null

/** Lazy-initialized Supabase admin client (service role). Safe at module scope. */
export function supabaseAdmin() {
  if (!_client) {
    _client = createClient(
      getSupabaseUrl(),
      getSupabaseAdminKey(),
    )
  }
  return _client
}
