import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({
    error: 'The Manifest-based bulk triage repair is retired. Review canonical reconciliation evidence before applying a governed lifecycle action.',
    code: 'manifest_bulk_triage_repair_retired',
    replacements: ['/api/reports/operational-reconciliation', '/api/leads/[id]/lifecycle'],
  }, { status: 410 })
}
