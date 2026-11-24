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
const MMS_SID = /^MM[0-9a-f]{32}$/i

function integer(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

async function run(request: Request, apply: boolean) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown> = {}
  if (request.method === 'POST') {
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: HEADERS })
    }
  }
  const url = new URL(request.url)
  const days = integer(body.days ?? url.searchParams.get('days'), 30)
  const limit = integer(body.limit ?? url.searchParams.get('limit'), 100)
  const messageSid = String(body.messageSid ?? url.searchParams.get('messageSid') ?? '').trim()
  if (days === null || limit === null || (messageSid && !MMS_SID.test(messageSid))) {
    return NextResponse.json({ error: 'Invalid backfill request' }, { status: 400, headers: HEADERS })
  }
  if (limit < 1 || limit > 100) {
    return NextResponse.json({ error: 'Invalid backfill request' }, { status: 400, headers: HEADERS })
  }

  let since: string
  try {
    since = inboundMmsBackfillSince(days)
  } catch {
    return NextResponse.json({ error: 'Invalid backfill request' }, { status: 400, headers: HEADERS })
  }

  try {
    const db = supabaseAdmin() as unknown as InboundMmsBackfillDb
    const rows = await loadInboundMmsBackfillRows(db, { since, messageSid: messageSid || undefined, limit })
    const report = await backfillInboundMmsActivities({
      rows,
      apply,
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

export async function GET(request: Request) {
  return run(request, false)
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  let apply = false
  try {
    const parsed = await request.clone().json()
    apply = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.apply === true)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: HEADERS })
  }
  return run(request, apply)
}
