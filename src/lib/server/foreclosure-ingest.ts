import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  type ForeclosureNoticeType,
  type IngestControl,
  mergeIngestControls,
  normalizeCounty,
  parseNoticeType,
} from '@/lib/prospecting/foreclosure'
import { supabase } from '@/lib/supabase-lazy'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'

const INGEST_TABLE = 'mortgage_foreclosure_ingest_controls'

function databaseError(error: { message?: string; code?: string } | null | undefined): ForeclosureError {
  const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
    return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure storage is not available in this environment yet.')
  }
  console.error('[foreclosure] ingest error', { code: error?.code || 'unknown' })
  return new ForeclosureError('foreclosure_unavailable', 503, 'Foreclosure ingest could not be saved.')
}

export async function listForeclosureIngestControls(): Promise<IngestControl[]> {
  const { data, error } = await supabase.from(INGEST_TABLE).select('county,notice_type,paused,updated_since')
  if (error) throw databaseError(error)
  const rows = ((data ?? []) as Array<{ county: string; notice_type: string; paused: boolean; updated_since: string | null }>)
    .flatMap((row) => {
      const noticeType = parseNoticeType(row.notice_type)
      const county = normalizeCounty(row.county)
      if (!noticeType || !county) return []
      return [{ county, noticeType, paused: Boolean(row.paused), updatedSince: row.updated_since }]
    })
  return mergeIngestControls(rows)
}

export async function setForeclosureIngestControl(
  actor: AuthenticatedActor,
  input: { county?: unknown; noticeType?: unknown; paused?: unknown; updatedSince?: unknown },
): Promise<IngestControl> {
  const county = normalizeCounty(input.county)
  const noticeType = parseNoticeType(input.noticeType)
  if (!county || !noticeType) {
    throw new ForeclosureError('invalid_ingest', 400, 'County and notice type are required to pause ingest.')
  }
  const existing = await supabase.from(INGEST_TABLE).select('paused,updated_since').eq('county', county).eq('notice_type', noticeType).maybeSingle<{ paused: boolean; updated_since: string | null }>()
  if (existing.error) throw databaseError(existing.error)
  const nextPaused = input.paused === undefined
    ? Boolean(existing.data?.paused)
    : input.paused === true || input.paused === 'true' || input.paused === '1'
  let nextWatermark = existing.data?.updated_since ?? null
  if (input.updatedSince !== undefined) {
    if (input.updatedSince == null || input.updatedSince === '') {
      nextWatermark = null
    } else {
      const watermark = timestampOrNull(input.updatedSince)
      if (!watermark) throw new ForeclosureError('invalid_ingest', 400, 'updated_since must be a date or timestamp.')
      nextWatermark = watermark
    }
  }
  const { error } = await supabase.from(INGEST_TABLE).upsert({
    county,
    notice_type: noticeType,
    paused: nextPaused,
    updated_since: nextWatermark,
    updated_by: actor.email,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'county,notice_type' })
  if (error) throw databaseError(error)
  return { county, noticeType: noticeType as ForeclosureNoticeType, paused: nextPaused, updatedSince: nextWatermark }
}

function timestampOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const value = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}
