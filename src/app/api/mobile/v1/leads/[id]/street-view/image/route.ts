import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { fetchStreetViewImage, lookupStreetView, StreetViewServiceError } from '@/lib/mobile-api/street-view'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function OPTIONS() { return mobileOptionsResponse() }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'A valid lead id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    const expectedPano = req.nextUrl.searchParams.get('pano')
    const expectedHeading = Number(req.nextUrl.searchParams.get('heading'))
    if (!expectedPano || !req.nextUrl.searchParams.has('heading') || !Number.isFinite(expectedHeading)) {
      return NextResponse.json({ error: 'A selected panorama and heading are required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const { lead } = await requireAuthorizedMobileLead(req, id)
    const panorama = await lookupStreetView(lead)
    if (!panorama.available || panorama.panoId !== expectedPano || Math.abs(panorama.heading - expectedHeading) > 0.001) {
      return NextResponse.json({ error: 'Panorama changed. Refresh Street View before loading the image.' }, { status: 409, headers: mobileNoStoreHeaders() })
    }
    const image = await fetchStreetViewImage(expectedPano, expectedHeading)
    return new NextResponse(image.body, {
      status: 200,
      headers: { ...mobileNoStoreHeaders(), 'Content-Type': 'image/jpeg' },
    })
  } catch (error) {
    const known = error instanceof MobileAuthError || error instanceof MobileLeadAccessError
    const status = known ? error.status : 503
    const message = known || error instanceof StreetViewServiceError ? error.message : 'Street View image is temporarily unavailable.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
