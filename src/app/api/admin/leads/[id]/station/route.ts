import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({
    error: 'Direct admin station mutation is retired. Use the governed contact lifecycle action.',
    code: 'admin_station_mutation_retired',
    replacement: '/api/leads/[id]/lifecycle',
  }, { status: 410 })
}
