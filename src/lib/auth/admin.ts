import { createClient } from '@/lib/supabase/server'

export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const sb = await createClient()
    // The proxy already verifies the asymmetric session token before an app
    // request reaches this helper. Reuse those verified claims locally so
    // identity-aware server pages do not pay a second regional Auth request.
    const { data, error } = await sb.auth.getClaims()
    if (error) return null
    const email = data?.claims?.email
    return typeof email === 'string' ? email.trim().toLowerCase() || null : null
  } catch {
    return null
  }
}

export async function isCurrentUserAdmin(currentEmail?: string): Promise<boolean> {
  const email = currentEmail?.trim().toLowerCase() || await getCurrentUserEmail()
  if (!email) return false
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data } = await supabaseAdmin()
      .from('agent_profiles')
      .select('is_admin')
      .eq('email', email)
      .maybeSingle()
    return Boolean(data?.is_admin)
  } catch {
    return false
  }
}
