import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    error: 'The Manifest-derived appointment dashboard is retired. Use the canonical operating report.',
    code: 'manifest_appointment_dashboard_retired',
    replacement: '/api/reports/operating?period=30d',
  }, { status: 410 })
}
