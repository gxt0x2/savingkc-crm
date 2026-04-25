import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    return user?.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const email = await getCurrentUserEmail()
  if (!email) return false
  const { data } = await supabaseAdmin()
    .from('agent_profiles')
    .select('is_admin')
    .eq('email', email)
    .maybeSingle()
  return Boolean(data?.is_admin)
}
