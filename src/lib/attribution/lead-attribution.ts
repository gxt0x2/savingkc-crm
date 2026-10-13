// Standard lead attribution record (schema v1). Stored on leads.attribution (JSONB).
// Every lead source fills what applies; unknown fields are omitted, never invented.

export type LeadSourceType =
  | 'website_form' | 'web_click_to_call' | 'inbound_call' | 'inbound_sms'
  | 'dialer' | 'import' | 'manual' | 'mobile_manual' | 'prospect_promotion' | 'other'

export type AttributionTouch = {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  referrer?: string
  landing_page?: string
  at?: string
}

export type PageView = { path: string; at?: string }

export type LeadAttribution = {
  schema: 'lead_attribution_v1'
  lead_source_type: LeadSourceType
  first_touch?: AttributionTouch
  last_touch?: AttributionTouch
  page_history?: PageView[]
  ga_client_id?: string
  ga_session_id?: string
  site_session_id?: string
  first_visit_at?: string
  device?: { type?: string; ua?: string; viewport?: string; lang?: string }
  form?: { source?: string; step?: string; status?: string }
  phone?: { tracking_number?: string; caller_number?: string; call_sid?: string }
  dialer?: { provider?: string; campaign_id?: string; list_id?: string }
  import?: { batch_id?: string; file_name?: string; list_name?: string }
  captured_at?: string
  derived_from?: string
}

export const PAGE_HISTORY_CAP = 20
const MAX_STR = 500

function str(value: unknown, max = MAX_STR): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t ? t.slice(0, max) : undefined
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function compact<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return Object.keys(out).length ? (out as T) : undefined
}

/** GA4 client id from a raw _ga cookie value ("GA1.1.123.456") or an already-parsed id. */
export function gaClientIdFromCookie(value: unknown): string | undefined {
  const s = str(value, 100)
  if (!s) return undefined
  const m = s.match(/(\d+\.\d+)$/)
  return m ? m[1] : undefined
}

export function normalizeTouch(value: unknown): AttributionTouch | undefined {
  const t = rec(value)
  return compact({
    source: str(t.source ?? t.utm_source, 120),
    medium: str(t.medium ?? t.utm_medium, 120),
    campaign: str(t.campaign ?? t.utm_campaign, 200),
    term: str(t.term ?? t.utm_term, 200),
    content: str(t.content ?? t.utm_content, 200),
    gclid: str(t.gclid, 200),
    gbraid: str(t.gbraid, 200),
    wbraid: str(t.wbraid, 200),
    referrer: str(t.referrer),
    landing_page: str(t.landing_page ?? t.landingUrl ?? t.landing_url),
    at: str(t.at ?? t.ts, 40),
  })
}

export function normalizePageHistory(value: unknown): PageView[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows = value
    .map((v) => (typeof v === 'string' ? { path: v } : rec(v)))
    .map((v) => compact({ path: str(v.path ?? v.p, 300), at: str(v.at ?? v.t, 40) }) as PageView | undefined)
    .filter((v): v is PageView => Boolean(v?.path))
  return rows.length ? rows.slice(-PAGE_HISTORY_CAP) : undefined
}

/**
 * Build the standard record for a website form submit.
 * `touch` is the first-party script payload (body.touch); `legacy` carries the
 * fields the form already posts (referrer, landing_url, session_id, form_source, attribution{}).
 */
export function websiteFormAttribution(input: {
  touch: unknown
  legacy: { referrer?: string | null; landingUrl?: string | null; sessionId?: string | null; formSource?: string | null; attribution?: Record<string, unknown> }
  userAgent?: string | null
  now?: string
}): LeadAttribution {
  const touch = rec(input.touch)
  const legacyAttr = rec(input.legacy.attribution)
  const fallbackTouch = normalizeTouch({
    ...legacyAttr,
    referrer: input.legacy.referrer ?? legacyAttr.referrer,
    landing_page: input.legacy.landingUrl ?? legacyAttr.landingUrl,
  })
  const device = rec(touch.device)
  return compact({
    schema: 'lead_attribution_v1' as const,
    lead_source_type: 'website_form' as const,
    first_touch: normalizeTouch(touch.first_touch) ?? fallbackTouch,
    last_touch: normalizeTouch(touch.last_touch) ?? fallbackTouch,
    page_history: normalizePageHistory(touch.page_history),
    ga_client_id: gaClientIdFromCookie(touch.ga_client_id),
    ga_session_id: str(touch.ga_session_id, 40),
    site_session_id: str(input.legacy.sessionId ?? undefined, 64),
    first_visit_at: str(touch.first_visit_at, 40),
    device: compact({
      type: str(device.type, 20),
      ua: str(input.userAgent ?? undefined, 300),
      viewport: str(device.viewport, 20),
      lang: str(device.lang, 20),
    }),
    form: compact({
      source: str(input.legacy.formSource ?? undefined, 80),
      step: str(legacyAttr.form_step, 40),
      status: str(legacyAttr.form_status, 40),
    }),
    captured_at: input.now ?? new Date().toISOString(),
  }) as LeadAttribution
}

/** Non-web sources: fill only what applies. */
export function nonWebAttribution(
  type: LeadSourceType,
  extra: Pick<LeadAttribution, 'phone' | 'dialer' | 'import'> & { campaign?: string },
  now?: string,
): LeadAttribution {
  return compact({
    schema: 'lead_attribution_v1' as const,
    lead_source_type: type,
    first_touch: extra.campaign ? { campaign: extra.campaign } : undefined,
    phone: extra.phone && compact(extra.phone),
    dialer: extra.dialer && compact(extra.dialer),
    import: extra.import && compact(extra.import),
    captured_at: now ?? new Date().toISOString(),
  }) as LeadAttribution
}

/**
 * Merge rule: first_touch / first_visit_at are write-once (earliest wins);
 * everything else takes the newest value.
 */
export function mergeLeadAttribution(existing: unknown, next: LeadAttribution): LeadAttribution {
  const prev = rec(existing) as Partial<LeadAttribution>
  if (prev.schema !== 'lead_attribution_v1') return next
  return {
    ...prev,
    ...next,
    lead_source_type: prev.lead_source_type ?? next.lead_source_type,
    first_touch: prev.first_touch ?? next.first_touch,
    first_visit_at: prev.first_visit_at ?? next.first_visit_at,
  } as LeadAttribution
}
