import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { dialerExportCsv, readDialerExport, type DialerExportRow } from '@/lib/source-lists/dialer-export'
import { normalizeSourceListLane, SourceListImportError, SOURCE_LIST_COUNTIES } from '@/lib/source-lists/csv'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function filters(url: URL) {
  const listType = url.searchParams.get('listType')
  const county = url.searchParams.get('county')
  const state = url.searchParams.get('state')
  const violationKind = url.searchParams.get('violationKind')
  const sourceListId = url.searchParams.get('sourceListId')
  const lane = listType
    ? normalizeSourceListLane({
        listType,
        county,
        state,
        violationKind,
      })
    : null
  if (!lane && county && !SOURCE_LIST_COUNTIES.includes(county.trim().toLowerCase() as typeof SOURCE_LIST_COUNTIES[number])) {
    throw new SourceListImportError('County must be Jackson, Clay, Platte, Johnson, or Wyandotte.', 400, 'invalid_lane')
  }
  if (sourceListId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceListId)) {
    throw new SourceListImportError('Source list id is invalid.', 400, 'invalid_source_list')
  }
  return { lane, county: lane?.county ?? (county ? county.trim().toLowerCase() : null), sourceListId }
}

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (await resolveOauthReviewSandboxLeadId(request)) {
    return NextResponse.json({ error: 'This account cannot export source lists' }, { status: 403, headers: NO_STORE })
  }

  try {
    const url = new URL(request.url)
    const selected = filters(url)
    const format = url.searchParams.get('format') || 'csv'
    if (format !== 'csv' && format !== 'json') {
      throw new SourceListImportError('Format must be csv or json.', 400, 'invalid_format')
    }

    const rows = await readDialerExport(async (from, to) => {
      let query = supabaseAdmin()
        .from('source_list_dialer_export')
        .select('*')
        .order('list_type', { ascending: true })
        .order('county', { ascending: true })
        .order('parcel_id', { ascending: true })
        .order('phone_e164', { ascending: true })
      if (selected.lane) query = query.eq('list_type', selected.lane.listType)
      if (selected.lane?.state) query = query.eq('state', selected.lane.state)
      if (selected.lane?.violationKind) query = query.eq('violation_kind', selected.lane.violationKind)
      if (selected.county) query = query.eq('county', selected.county)
      if (selected.sourceListId) query = query.eq('source_list_id', selected.sourceListId)
      const { data, error } = await query.range(from, to)
      return { data: data as DialerExportRow[] | null, error }
    })

    if (format === 'json') {
      return NextResponse.json({ count: rows.length, rows }, { headers: NO_STORE })
    }
    return new NextResponse(dialerExportCsv(rows), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="source-list-dialer-export.csv"',
      },
    })
  } catch (error) {
    if (error instanceof SourceListImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    console.error('[source-lists] dialer export failed', error)
    return NextResponse.json(
      { error: 'The dialer export is unavailable.', code: 'source_list_unavailable' },
      { status: 503, headers: NO_STORE },
    )
  }
}
