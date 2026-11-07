/**
 * Lead journey for the Path-to-lead panel (handoff Item 1).
 *
 * Website journey events (savingkc.com/skc-journey.js) and paid-lander events
 * land in ppc_tracking_events keyed by the browser session (skc_sid). A web
 * lead stores the same id in leads.session_id, so the journey is every
 * non-test event for that session, plus anything already linked by lead_id.
 */
export type JourneyStep = {
  at: string
  event: string
  page: string | null
  source: string | null
  detail: string | null
}

export type JourneyRow = {
  event_name: string
  event_time: string
  page_path: string | null
  page_location: string | null
  traffic_source: string | null
  payload: Record<string, unknown> | null
}

const HIDDEN = new Set(['skc_phone_number_selected', 'ppc_landing_request'])

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pathOf(row: JourneyRow): string | null {
  if (row.page_path) return row.page_path
  if (!row.page_location) return null
  try { const u = new URL(row.page_location); return u.pathname + u.search } catch { return row.page_location }
}

function detailFor(row: JourneyRow): string | null {
  const p = row.payload ?? {}
  switch (row.event_name) {
    case 'cta_click': return [str(p.cta_label), str(p.cta_location) && `in ${str(p.cta_location)}`].filter(Boolean).join(' ') || null
    case 'phone_click': return str(p.phone_spot) ? `from ${str(p.phone_spot)}` : null
    case 'form_step_completed': return typeof p.completed_step === 'number' ? `step ${p.completed_step}${str(p.step_name) ? ` (${str(p.step_name)})` : ''}` : null
    case 'quiz_started':
    case 'quiz_qualified': return [str(p.situation), str(p.timeline), str(p.condition)].filter(Boolean).join(' · ') || null
    case 'contact_started': return str(p.field) ? `typed ${str(p.field)}` : null
    case 'scroll_depth': return typeof p.percent === 'number' ? `${p.percent}%` : null
    case 'page_view': return str(p.ai_source) && p.ai_source !== 'none' ? `via ${str(p.ai_source)}` : null
    default: return null
  }
}

export function buildLeadJourney(rows: JourneyRow[], limit = 60): JourneyStep[] {
  return rows
    .filter((row) => !HIDDEN.has(row.event_name))
    .sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time))
    .slice(-limit)
    .map((row) => ({
      at: row.event_time,
      event: row.event_name,
      page: pathOf(row),
      source: row.traffic_source,
      detail: detailFor(row),
    }))
}

type Db = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: unknown) => {
        maybeSingle?: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
        eq?: (col: string, value: unknown) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> } }
      }
    }
  }
}

export async function loadLeadJourney(db: Db, leadId: string): Promise<{ journey: JourneyStep[]; sessionId: string | null } | { error: string; status: number }> {
  const leadRes = await db.from('leads').select('id, session_id').eq('id', leadId).maybeSingle!()
  if (leadRes.error) return { error: leadRes.error.message, status: 500 }
  const lead = leadRes.data as { id: string; session_id: string | null } | null
  if (!lead) return { error: 'Lead not found', status: 404 }
  const cols = 'event_name, event_time, page_path, page_location, traffic_source, payload'
  const queries = [db.from('ppc_tracking_events').select(cols).eq('lead_id', leadId).eq!('is_test', false).order('event_time', { ascending: true }).limit(200)]
  if (lead.session_id) queries.push(db.from('ppc_tracking_events').select(cols).eq('session_id', lead.session_id).eq!('is_test', false).order('event_time', { ascending: true }).limit(200))
  const results = await Promise.all(queries)
  const failed = results.find((r) => r.error)
  if (failed?.error) return { error: failed.error.message, status: 500 }
  const seen = new Set<string>()
  const rows: JourneyRow[] = []
  for (const r of results) for (const row of (r.data as JourneyRow[] | null) ?? []) {
    const key = `${row.event_name}|${row.event_time}|${row.page_path ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return { journey: buildLeadJourney(rows), sessionId: lead.session_id }
}
