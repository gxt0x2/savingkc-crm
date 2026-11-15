import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { RECORDING_ARCHIVE_RATE_LIMIT_MS, runStoredRecordingBackfill } from '@/lib/server/call-recording-archive'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'private, no-store' }

/**
 * One-shot archive of Mojo and Twilio recordings that are not in our buckets yet.
 * GET is always a dry-run. POST with apply=1 copies one rate-limited page. Not scheduled.
 */
async function handle(request: Request, apply: boolean) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  const url = new URL(request.url)
  try {
    const report = await runStoredRecordingBackfill({
      apply,
      cursor: url.searchParams.get('cursor'),
      limit: Number(url.searchParams.get('limit') || 5),
      rateLimitMs: apply ? RECORDING_ARCHIVE_RATE_LIMIT_MS : 0,
    })
    return NextResponse.json({ ok: report.failed === 0, ...report }, {
      status: report.failed ? 500 : 200,
      headers: HEADERS,
    })
  } catch {
    return NextResponse.json({ error: 'Recording archive failed' }, { status: 500, headers: HEADERS })
  }
}

export async function GET(request: Request) {
  return handle(request, false)
}

export async function POST(request: Request) {
  const apply = new URL(request.url).searchParams.get('apply') === '1'
  return handle(request, apply)
}
