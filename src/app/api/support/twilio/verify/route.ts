import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { supabase } from '@/lib/supabase-lazy'
import {
  verifyTwilioAccountCredentials,
  type TwilioVerificationResult,
} from '@/lib/support/twilio-verification'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie',
}

type AuthorizationResult = 'authorized' | 'forbidden' | 'unavailable'

function json(body: Record<string, unknown> | TwilioVerificationResult, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

async function authorizeOwnerOrAdmin(email: string): Promise<AuthorizationResult> {
  try {
    const { data, error } = await supabase
      .from('agent_profiles')
      .select('role, is_admin')
      .eq('email', email)
      .maybeSingle()

    if (error) return 'unavailable'
    if (data?.is_admin || data?.role === 'owner') return 'authorized'
    return 'forbidden'
  } catch {
    return 'unavailable'
  }
}

/**
 * Authenticated, owner/admin-only credential verification. This path is kept
 * outside proxy trusted-bearer prefixes, and the handler never accepts a
 * service or health bearer as an alternative to a CRM session.
 */
export async function GET(request: NextRequest) {
  // Deliberately ignore all bearer headers; only the verified CRM session below
  // can authorize this support endpoint.
  void request
  const email = await getCurrentUserEmail()
  if (!email) return json({ error: 'Unauthorized' }, 401)

  const authorization = await authorizeOwnerOrAdmin(email)
  if (authorization === 'forbidden') return json({ error: 'Forbidden' }, 403)
  if (authorization === 'unavailable') return json({ error: 'Authorization unavailable' }, 503)

  try {
    const result = await verifyTwilioAccountCredentials()
    return json(result, result.ok ? 200 : 503)
  } catch {
    return json({ error: 'Twilio diagnostic unavailable' }, 503)
  }
}
