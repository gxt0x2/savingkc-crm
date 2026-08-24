import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    error: 'Legacy stage advancement is retired. Use the governed contact lifecycle action.',
    code: 'legacy_stage_route_retired',
    replacement: '/api/leads/[id]/lifecycle',
  }, { status: 410 })
}
