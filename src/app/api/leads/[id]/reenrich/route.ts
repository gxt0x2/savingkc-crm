export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { forceReenrichLead } from '@/lib/auto-enrich'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ success: false, error: 'A valid lead id is required.' }, {
      status: 400,
      headers: NO_STORE,
    })
  }

  const result = await forceReenrichLead(id)
  if (!result.success) {
    return NextResponse.json(result, {
      status: result.error === 'Lead not found' ? 404 : 503,
      headers: NO_STORE,
    })
  }

  return NextResponse.json(result, { headers: NO_STORE })
}
