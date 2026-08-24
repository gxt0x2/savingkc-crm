import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({
    error: 'The Manifest-based stuck-station repair is retired. Use lifecycle reconciliation and governed contact lifecycle actions.',
    code: 'manifest_stuck_station_repair_retired',
    replacements: ['/api/reports/lifecycle-reconciliation', '/api/leads/[id]/lifecycle'],
  }, { status: 410 })
}
