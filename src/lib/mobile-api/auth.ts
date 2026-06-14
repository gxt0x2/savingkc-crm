import { createClient, type User } from '@supabase/supabase-js'
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env'

export type MobileApiUser = {
  accessToken: string
  user: User
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

export function mobileOptionsResponse() {
  return new Response(null, {
    status: 204,
    headers: mobileCorsHeaders(),
  })
}
