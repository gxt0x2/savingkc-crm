import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { exportLineModeBlock } from '@/lib/dialer-suppression-policy'
import { lineCheckBlockEnabled } from '@/lib/server/phone-line-check'
import { dialerExportCsv, recordDialerExportBatch } from '@/lib/source-lists/dialer-export'
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

    const lineModeRaw = url.searchParams.get('lineMode')
    const lineMode = lineModeRaw === null || lineModeRaw.trim() === ''
      ? 1
      : (/^\d+$/.test(lineModeRaw.trim()) ? Number(lineModeRaw.trim()) : 0)
    if (exportLineModeBlock(lineMode)) {
      throw new SourceListImportError(
        'Multi-line dialer export is suspended. Export one line at a time.',
        409,
        'multi_line_suspended',
      )
    }
    const db = supabaseAdmin()
    const { error: flagError } = await db.rpc('sync_phone_line_check_config_v1', {
      p_block_enabled: lineCheckBlockEnabled(),
      p_cost_usd: null,
    })
    if (flagError && !/schema cache|could not find the function|PGRST202/i.test(flagError.message ?? '')) {
      throw flagError
    }
    const scrub = await recordDialerExportBatch(db, actor.email, {
      listType: selected.lane?.listType ?? null,
      county: selected.county,
      state: selected.lane?.state ?? null,
      violationKind: selected.lane?.violationKind ?? null,
      sourceListId: selected.sourceListId,
      lineMode,
    })
    console.info(JSON.stringify({
      event: 'dialer_export_scrub',
      exportBatchId: scrub.exportBatchId,
      exported: scrub.rows.length,
      excludedCounts: scrub.excludedCounts,
      excludedPhones: scrub.excludedPhones,
    }))
    const headers = {
      ...NO_STORE,
      'X-Source-List-Export-Batch': scrub.exportBatchId,
      'X-Dialer-Export-Excluded-Counts': JSON.stringify(scrub.excludedCounts),
    }

    if (format === 'json') {
      return NextResponse.json({
        exportBatchId: scrub.exportBatchId,
        count: scrub.rows.length,
        rows: scrub.rows,
        excludedCounts: scrub.excludedCounts,
        excludedPhones: scrub.excludedPhones,
      }, { headers })
    }
    return new NextResponse(dialerExportCsv(scrub.rows), {
      headers: {
        ...headers,
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
