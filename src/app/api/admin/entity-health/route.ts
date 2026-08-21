export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { readCrmEntityHealth } from '@/lib/server/crm-entity-foundation'

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const health = await readCrmEntityHealth()
    return NextResponse.json(health, {
      status: health.available ? 200 : 503,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('CRM entity health failed', error)
    return NextResponse.json(
      { error: 'CRM entity health is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
