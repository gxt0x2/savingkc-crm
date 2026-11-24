import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { readActorGoogleSessionGrant } from '@/lib/mobile-api/google-session-grant'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const grant = await readActorGoogleSessionGrant(user.email)
    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        capabilities: {
          leadList: true,
          leadDetail: true,
          contacts: true,
          conversations: true,
          sms: true,
          email: true,
          outboundDeviceDialer: false,
          callDisposition: true,
          twilioNativeVoice: true,
          workQueue: true,
          ownerAssignment: true,
          handoffAcceptance: true,
          aiAssistantReadOnly: true,
          calendar: true,
          googleCalendar: grant.googleCalendar,
          gmail: grant.gmail,
        },
        messaging: {
          email: grant.email,
        },
      },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
