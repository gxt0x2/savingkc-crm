import { NextRequest, NextResponse } from 'next/server'
import { mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import { mobileAppointmentErrorResponse } from '@/lib/mobile-api/appointment-route'
import { loadActorGoogleOAuthToken } from '@/lib/gmail-send'
import { hasGoogleOAuthConfig } from '@/lib/gmail-sync'
import { CALENDAR_SCOPE, hasGoogleScope } from '@/lib/google-oauth-scopes'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }
/** Eligibility reflects stored authorization, not a successful live provider check. */
export async function GET(req: NextRequest) {
  try {
    const { actor } = await requireMobileCommandActor(req)
    const token = await loadActorGoogleOAuthToken(actor.email)
    const configured = hasGoogleOAuthConfig()
    const eligible = configured && Boolean(token && hasGoogleScope(token.scope, CALENDAR_SCOPE))
    return NextResponse.json({ accounts: eligible ? [{
      ownerEmail: actor.email, calendarId: 'primary', provider: 'google',
      accountEmail: token!.user_email, label: `${token!.user_email} · Primary`,
    }] : [], status: eligible ? 'connected' : 'not_configured', providerVerified: false },
    { headers: mobileNoStoreHeaders() })
  } catch (error) { return mobileAppointmentErrorResponse(error) }
}
