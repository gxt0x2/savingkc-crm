import { supabase } from '@/lib/supabase-lazy'
import { hasVerifiedSubject } from '@/lib/auth/verified-claims'
import { createClient } from '@/lib/supabase/server'

export interface AuthenticatedActor {
  email: string
  name: string
}

/** Resolve the request's verified CRM user and server-owned activity label. */
export async function resolveAuthenticatedActor(): Promise<AuthenticatedActor | null> {
  const authClient = await createClient()
  const claimsResult = await authClient.auth.getClaims()
  if (!hasVerifiedSubject(claimsResult)) return null
  const emailClaim = claimsResult.data?.claims?.email
  if (typeof emailClaim !== 'string' || !emailClaim.trim()) return null

  const email = emailClaim.trim().toLowerCase()
  try {
    const { data: profile } = await supabase
      .from('agent_profiles')
      .select('full_name')
      .eq('email', email)
      .maybeSingle()
    const profileName = typeof profile?.full_name === 'string' ? profile.full_name.trim() : ''
    return { email, name: profileName || email }
  } catch {
    return { email, name: email }
  }
}
