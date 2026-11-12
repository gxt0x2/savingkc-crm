import { NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import {
  backfillInboundMmsActivities,
  inboundMmsBackfillSince,
  loadInboundMmsBackfillRows,
  saveInboundMmsBackfill,
  type InboundMmsBackfillDb,
} from '@/lib/server/inbound-mms-backfill'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'private, no-store' }

/** Applies the last 30 days. The existing cron bearer is required; it is not scheduled. */
export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const db = supabaseAdmin() as unknown as InboundMmsBackfillDb
    const rows = await loadInboundMmsBackfillRows(db, { since: inboundMmsBackfillSince(30), limit: 100 })
    const report = await backfillInboundMmsActivities({
      rows,
      apply: true,
      save: (row, patch) => saveInboundMmsBackfill(db, row, patch),
    })
    return NextResponse.json({ ok: report.failed.length === 0, ...report }, {
      status: report.failed.length ? 500 : 200,
      headers: HEADERS,
    })
  } catch (error) {
    console.error('[backfill-inbound-mms] failed', error instanceof Error ? error.message : 'failed')
    return NextResponse.json({ error: 'Inbound MMS backfill failed' }, { status: 500, headers: HEADERS })
  }
}
