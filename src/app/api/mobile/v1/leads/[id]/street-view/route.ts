import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { lookupStreetView, StreetViewServiceError } from '@/lib/mobile-api/street-view'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function OPTIONS() { return mobileOptionsResponse() }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'A valid lead id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    const { lead } = await requireAuthorizedMobileLead(req, id)
    const result = await lookupStreetView(lead)
    return NextResponse.json(result.available
      ? { ...result, imageUrl: `/api/mobile/v1/leads/${encodeURIComponent(id)}/street-view/image?${new URLSearchParams({ pano: result.panoId, heading: String(result.heading) })}` }
      : result, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const known = error instanceof MobileAuthError || error instanceof MobileLeadAccessError
    const status = known ? error.status : 503
    const message = known || error instanceof StreetViewServiceError ? error.message : 'Street View lookup is temporarily unavailable.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
