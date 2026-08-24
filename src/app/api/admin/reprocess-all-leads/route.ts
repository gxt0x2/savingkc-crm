import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({
    error: 'The Manifest-based bulk reprocessing pipeline is retired. Use bounded canonical workers and reconciliation reports.',
    code: 'manifest_bulk_reprocess_retired',
    replacements: [
      '/api/workers/property-enrichment',
      '/api/cron/process-mojo-queue',
      '/api/reports/operational-reconciliation',
    ],
  }, { status: 410 })
}
