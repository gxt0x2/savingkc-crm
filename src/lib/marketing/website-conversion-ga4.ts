import { bucketSessionSource, finite, SOURCE_KEYS, type MetricStatus, type SourceKey } from './website-conversion'

/** ga4_event_daily row (analytics-sync source ga4_events). */
export type Ga4EventRow = {
  date: string
  event_name: string | null
  session_source_medium: string | null
  event_count: number | null
  key_events: number | null
}

/** Funnel steps shown on the board, in order. */
export const GA4_FUNNEL_EVENTS = [
  'page_view', 'cta_click', 'quiz_started', 'form_started', 'form_step_completed',
  'contact_started', 'phone_click', 'lead_submitted', 'generate_lead', 'appointment_booked',
] as const

export type Ga4FunnelRow = {
  event: string
  total: number
  keyEvents: number
  bySource: Record<SourceKey, number>
}

export type Ga4EventsSection = { status: MetricStatus; rows: Ga4FunnelRow[] }

/** Website conversion board's GA4 funnel, from ga4_event_daily rows inside the report window. */
export function buildGa4EventsSection(rows: Ga4EventRow[] | null | undefined, window: { start: string; end: string }): Ga4EventsSection {
  const ga4EventsStatus: MetricStatus = rows ? 'ready' : 'missing'
  const funnelByEvent = new Map<string, Ga4FunnelRow>()
  for (const name of GA4_FUNNEL_EVENTS) {
    funnelByEvent.set(name, {
      event: name,
      total: 0,
      keyEvents: 0,
      bySource: Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0])) as Record<SourceKey, number>,
    })
  }
  for (const row of rows ?? []) {
    const entry = funnelByEvent.get(row.event_name ?? '')
    if (!entry || row.date < window.start || row.date > window.end) continue
    const count = finite(row.event_count)
    entry.total += count
    entry.keyEvents += finite(row.key_events)
    entry.bySource[bucketSessionSource(row.session_source_medium)] += count
  }
  return { status: ga4EventsStatus, rows: ga4EventsStatus === 'ready' ? [...funnelByEvent.values()] : [] }
}
