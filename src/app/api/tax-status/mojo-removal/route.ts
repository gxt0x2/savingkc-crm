import { NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { mojoRemovalCsv } from '@/lib/tax-status/mojo-removal'
import { confirmPendingMojoRemovals, readPendingMojoRemovals, TaxStatusStoreError } from '@/lib/tax-status/persist'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const items = await readPendingMojoRemovals()
    const format = new URL(request.url).searchParams.get('format')
    if (format === 'json') {
      return NextResponse.json({
        ok: true,
        mojoWriteApi: null,
        removesBy: 'browser before 09:00 America/Chicago',
        items,
      }, { headers: HEADERS })
    }
    return new NextResponse(mojoRemovalCsv(items), {
      headers: {
        ...HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mojo-tax-removal.csv"',
      },
    })
  } catch (error) {
    if (error instanceof TaxStatusStoreError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503, headers: HEADERS })
    }
    return NextResponse.json({ ok: false, error: 'Mojo removal worklist is unavailable' }, { status: 500, headers: HEADERS })
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  let body: { ids?: unknown; confirmedBy?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Confirmation body must be JSON' }, { status: 400, headers: HEADERS })
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : []
  const actor = typeof body.confirmedBy === 'string' ? body.confirmedBy : ''
  try {
    const result = await confirmPendingMojoRemovals(ids, actor)
    return NextResponse.json({ ok: true, ...result, mojoWriteApi: null }, { headers: HEADERS })
  } catch (error) {
    if (error instanceof TaxStatusStoreError || (error instanceof Error && error.message === 'removal_actor_required')) {
      const message = error instanceof Error ? error.message : 'Confirmation failed'
      const status = message === 'removal_actor_required' ? 400 : 503
      return NextResponse.json({ ok: false, error: message }, { status, headers: HEADERS })
    }
    return NextResponse.json({ ok: false, error: 'Mojo removal confirmation failed' }, { status: 500, headers: HEADERS })
  }
}
