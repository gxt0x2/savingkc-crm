import { createClient, type User } from '@supabase/supabase-js'
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export type MobileApiUser = {
  accessToken: string
  user: User
}

export type MobileApiActor = MobileApiUser & {
  actor: {
    email: string
    name: string
  }
}

export class MobileAuthError extends Error {
  status = 401
}

export function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') || ''
  const [scheme, token] = authorization.split(/\s+/, 2)
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token.trim()
}

export async function requireMobileUser(req: Request): Promise<MobileApiUser> {
  const accessToken = getBearerToken(req)
  if (!accessToken) throw new MobileAuthError('Missing bearer token')

  const supabase = createClient(getSupabaseUrl(), getSupabasePublicKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data.user) throw new MobileAuthError('Invalid bearer token')

  return { accessToken, user: data.user }
}

/** Resolve a bearer-authenticated user to a server-owned CRM actor label. */
export async function requireMobileActor(req: Request): Promise<MobileApiActor> {
  const mobileUser = await requireMobileUser(req)
  const email = mobileUser.user.email?.trim().toLowerCase() ?? ''
  if (!email) throw new MobileAuthError('Authenticated user has no email')

  let name = resolveAgentTelephonyProfile(email).displayName
  try {
    const { data } = await supabaseAdmin()
      .from('agent_profiles')
      .select('full_name')
      .eq('email', email)
      .maybeSingle()
    const profileName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
    if (profileName) name = profileName
  } catch {
    // The verified email and server-owned roster remain safe fallbacks when
    // profile hydration is temporarily unavailable.
  }

  return { ...mobileUser, actor: { email, name } }
}

export function mobileNoStoreHeaders(): HeadersInit {
  return {
    ...mobileCorsHeaders(),
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store',
    Pragma: 'no-cache',
    Expires: '0',
    Vary: 'Authorization',
  }
}

export function mobileCorsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    'Access-Control-Max-Age': '86400',
  }
}

export function mobileOptionsResponse() {
  return new Response(null, {
    status: 204,
    headers: mobileCorsHeaders(),
  })
}
