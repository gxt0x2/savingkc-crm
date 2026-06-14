import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        capabilities: {
          leadList: true,
          leadDetail: true,
          outboundDeviceDialer: true,
          callDisposition: true,
          twilioNativeVoice: false,
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
