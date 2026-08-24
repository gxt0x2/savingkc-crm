import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function retiredResponse() {
  return NextResponse.json({
    error: 'The Manifest-based lead reprocessing pipeline is retired. Use canonical workers and reconciliation reports.',
    code: 'manifest_lead_reprocess_retired',
    replacements: [
      '/api/workers/property-enrichment',
      '/api/cron/process-mojo-queue',
      '/api/reports/operational-reconciliation',
    ],
  }, { status: 410 })
}

export async function GET() {
  return retiredResponse()
}

export async function POST() {
  return retiredResponse()
}
