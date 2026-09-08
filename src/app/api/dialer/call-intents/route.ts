import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST() {
  return NextResponse.json({
    allowed: false,
    error: 'This dialer endpoint was retired. Refresh the CRM before calling.',
    reason: 'surface_context_mismatch',
    reasonSource: 'legacy_endpoint',
  }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  })
}
