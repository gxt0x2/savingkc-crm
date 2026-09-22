import 'server-only'

import { NextResponse } from 'next/server'
import { hasVerifiedSubject } from '@/lib/auth/verified-claims'
import { requireMobileActor } from '@/lib/mobile-api/auth'
import { createClient } from '@/lib/supabase/server'
import {
  oauthReviewSandboxAllowsLead,
  oauthReviewSandboxLeadId,
} from '@/lib/auth/oauth-review-sandbox'

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

/**
 * Returns the only lead id this session may see, or null for every other user.
 * Identity comes from the verified auth subject and email claim, never from
 * user-editable metadata.
 */
export async function resolveOauthReviewSandboxLeadId(request?: Request): Promise<string | null> {
  try {
    if (request?.headers.has('authorization')) {
      const { actor, user } = await requireMobileActor(request)
      return oauthReviewSandboxLeadId({ email: actor.email, userId: user.id })
    }

    const authClient = await createClient()
    const claimsResult = await authClient.auth.getClaims()
    if (!hasVerifiedSubject(claimsResult)) return null
    const claims = claimsResult.data?.claims as { sub?: unknown; email?: unknown } | undefined
    const userId = typeof claims?.sub === 'string' ? claims.sub : null
    const email = typeof claims?.email === 'string' ? claims.email : null
    return oauthReviewSandboxLeadId({ email, userId })
  } catch {
    return null
  }
}

export async function oauthReviewForeignLeadResponse(
  leadId: string | null | undefined,
  request?: Request,
): Promise<NextResponse | null> {
  const allowedLeadId = await resolveOauthReviewSandboxLeadId(request)
  if (oauthReviewSandboxAllowsLead(allowedLeadId, leadId)) return null
  return NextResponse.json(
    { error: 'Lead not found' },
    { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
  )
}
