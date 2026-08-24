import { NextRequest, NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { normalizeMojoPerformanceSnapshot } from '@/lib/server/mojo-performance'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  let snapshot
  try {
    snapshot = normalizeMojoPerformanceSnapshot(await request.json())
  } catch {
    return NextResponse.json(
      { error: 'A valid Mojo performance snapshot is required.' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const { data, error } = await supabaseAdmin().rpc('upsert_mojo_agent_daily_performance_v1', {
      p_snapshot: snapshot,
    })
    if (error) throw error

    return NextResponse.json(
      {
        ok: true,
        applied: Boolean(data?.applied),
        metricDate: snapshot.metricDate,
        sourceFetchedAt: snapshot.sourceFetchedAt,
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    console.error('[admin/mojo-performance] upsert failed', error)
    return NextResponse.json(
      { error: 'Mojo performance snapshot could not be stored.' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
