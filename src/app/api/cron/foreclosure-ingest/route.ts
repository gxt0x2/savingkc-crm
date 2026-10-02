import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'
import { runForeclosureDailyIngest } from '@/lib/server/foreclosure-daily-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

async function readOptionalCsv(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (file instanceof File) return await file.text()
    const csv = form.get('csv')
    return typeof csv === 'string' ? csv : null
  }
  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    const text = await request.text()
    return text.trim() ? text : null
  }
  if (contentType.includes('application/json')) {
    try {
      const body = await request.json() as { csv?: unknown }
      return typeof body.csv === 'string' ? body.csv : null
    } catch {
      return null
    }
  }
  return null
}

async function handle(request: Request, allowBody: boolean) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const csvBody = allowBody ? await readOptionalCsv(request) : null
    const result = await runForeclosureDailyIngest({ csvBody })
    const status = result.provider.status === 'error' ? 502 : 200
    return NextResponse.json(result, { status, headers: HEADERS })
  } catch (error) {
    if (error instanceof ForeclosureError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: HEADERS },
      )
    }
    console.error('[foreclosure-daily-ingest] cron failed', error)
    return NextResponse.json(
      { error: 'Foreclosure daily ingest is temporarily unavailable.', code: 'foreclosure_unavailable' },
      { status: 503, headers: HEADERS },
    )
  }
}

/** Vercel cron + manual freshness / stale alert pass. */
export async function GET(request: Request) {
  return handle(request, false)
}

/** Same as GET, plus optional CSV body / file for operator or GH Action drops. */
export async function POST(request: Request) {
  return handle(request, true)
}
