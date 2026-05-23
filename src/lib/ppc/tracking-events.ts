import { supabase } from '@/lib/supabase-lazy'
import { cleanJsonRecord } from '@/lib/ppc/conversion-outbox'

export const SITUATION_TO_TAG = {
  'tax-delinquent': 'tax_delinquent',
  inherited: 'inherited',
  'tired-landlord': 'tired_landlord',
  condition: 'distressed_condition',
  'life-event': 'life_event',
  other: 'ppc_other',
} as const

export const TIMELINE_TO_URGENCY = {
  asap: 'critical',
  '60-days': 'high',
  flexible: 'medium',
  exploring: 'low',
} as const

export const CONDITION_TO_OVERALL = {
  good: 'good',
  'needs-work': 'fair',
  'major-repair': 'poor',
  vacant: 'poor',
} as const

export type PpcTrackingEventCategory = 'visit' | 'form' | 'phone' | 'call' | 'conversion' | 'error' | 'web'

export type PpcTrackingAttribution = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  gad_source?: string
  gad_campaignid?: string
  gad_adgroupid?: string
  referrer?: string
  landingUrl?: string
}

export type RecordPpcTrackingEventInput = {
  eventId: string
  eventName: string
  eventCategory?: PpcTrackingEventCategory
  eventTime?: string | Date
  sessionId?: string | null
  visitorId?: string | null
  leadId?: string | null
  manifestId?: string | null
  activityId?: string | null
  pagePath?: string | null
  pageLocation?: string | null
  pageReferrer?: string | null
  trafficSource?: string | null
  campaign?: string | null
  formStep?: number | null
  formStatus?: string | null
  situation?: string | null
  timeline?: string | null
  condition?: string | null
  phoneNumber?: string | null
  smsConsent?: boolean | null
  isTest?: boolean
  attribution?: PpcTrackingAttribution | null
  payload?: Record<string, unknown> | null
}

export type PpcTrackingEventRow = {
  event_id: string
  event_name: string
  event_category: PpcTrackingEventCategory
  event_time: string
  session_id: string | null
  visitor_id: string | null
  lead_id: string | null
  manifest_id: string | null
  activity_id: string | null
  page_path: string | null
  page_location: string | null
  page_referrer: string | null
  traffic_source: string | null
  campaign: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  gad_source: string | null
  gad_campaignid: string | null
  gad_adgroupid: string | null
  form_step: number | null
  form_status: string | null
  situation_raw: string | null
  timeline_raw: string | null
  condition_raw: string | null
  situation_tag: string | null
  timeline_urgency: string | null
  condition_overall: string | null
  phone_number: string | null
  sms_consent: boolean | null
  is_test: boolean
  payload: Record<string, unknown>
}

type TrackingEventTable = {
  upsert: (
    row: PpcTrackingEventRow,
    options: { onConflict: string; ignoreDuplicates: boolean },
  ) => PromiseLike<{ error: { code?: string; message?: string } | null }>
}

type TrackingEventClient = {
  from: (table: string) => TrackingEventTable
}

function iso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function bool(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function hasTestMarker(...values: Array<unknown>): boolean {
  return values.some((value) => typeof value === 'string' && /(^|[^a-z0-9])(codex|test|dummy|probe|smoke)([^a-z0-9]|$)/i.test(value))
}

function categoryFor(eventName: string, fallback?: PpcTrackingEventCategory): PpcTrackingEventCategory {
  if (fallback) return fallback
  if (eventName === 'ppc_visit_started' || eventName === 'page_view') return 'visit'
  if (eventName === 'phone_click' || eventName === 'skc_phone_number_selected') return 'phone'
  if (eventName === 'form_error') return 'error'
  if (eventName.startsWith('lead_') || eventName === 'appointment_booked') return 'conversion'
  if (eventName === 'address_typed' || eventName === 'ppc_potential_lead_created') return 'form'
  if (eventName.includes('form') || eventName.includes('step') || eventName.endsWith('_selected')) return 'form'
  return 'web'
}

export function buildPpcTrackingEventRow(input: RecordPpcTrackingEventInput): PpcTrackingEventRow {
  const attribution = input.attribution ?? {}
  const situation = text(input.situation)
  const timeline = text(input.timeline)
  const condition = text(input.condition)
  const gclid = text(attribution.gclid)
  const gbraid = text(attribution.gbraid)
  const wbraid = text(attribution.wbraid)
  const pageLocation = text(input.pageLocation) || text(attribution.landingUrl)
  const payload = cleanJsonRecord({
    ...(input.payload ?? {}),
    attribution,
  })

  return {
    event_id: input.eventId,
    event_name: input.eventName,
    event_category: categoryFor(input.eventName, input.eventCategory),
    event_time: iso(input.eventTime),
    session_id: text(input.sessionId),
    visitor_id: text(input.visitorId),
    lead_id: text(input.leadId),
    manifest_id: text(input.manifestId),
    activity_id: text(input.activityId),
    page_path: text(input.pagePath),
    page_location: pageLocation,
    page_referrer: text(input.pageReferrer) || text(attribution.referrer),
    traffic_source: text(input.trafficSource) || 'google_ads',
    campaign: text(input.campaign) || text(attribution.utm_campaign) || 'Search 2026',
    utm_source: text(attribution.utm_source),
    utm_medium: text(attribution.utm_medium),
    utm_campaign: text(attribution.utm_campaign),
    utm_term: text(attribution.utm_term),
    utm_content: text(attribution.utm_content),
    gclid,
    gbraid,
    wbraid,
    gad_source: text(attribution.gad_source),
    gad_campaignid: text(attribution.gad_campaignid),
    gad_adgroupid: text(attribution.gad_adgroupid),
    form_step: typeof input.formStep === 'number' ? input.formStep : null,
    form_status: text(input.formStatus),
    situation_raw: situation,
    timeline_raw: timeline,
    condition_raw: condition,
    situation_tag: situation && situation in SITUATION_TO_TAG ? SITUATION_TO_TAG[situation as keyof typeof SITUATION_TO_TAG] : null,
    timeline_urgency: timeline && timeline in TIMELINE_TO_URGENCY ? TIMELINE_TO_URGENCY[timeline as keyof typeof TIMELINE_TO_URGENCY] : null,
    condition_overall: condition && condition in CONDITION_TO_OVERALL ? CONDITION_TO_OVERALL[condition as keyof typeof CONDITION_TO_OVERALL] : null,
    phone_number: text(input.phoneNumber),
    sms_consent: bool(input.smsConsent),
    is_test: Boolean(input.isTest) || hasTestMarker(input.eventId, gclid, gbraid, wbraid, input.sessionId, input.visitorId),
    payload,
  }
}

export async function recordPpcTrackingEvent(
  input: RecordPpcTrackingEventInput,
  client: TrackingEventClient = supabase as unknown as TrackingEventClient,
): Promise<{ recorded: true; row: PpcTrackingEventRow } | { recorded: false; row: PpcTrackingEventRow; reason: string }> {
  const row = buildPpcTrackingEventRow(input)

  try {
    const { error } = await client.from('ppc_tracking_events').upsert(row, {
      onConflict: 'event_id',
      ignoreDuplicates: true,
    })

    if (!error) return { recorded: true, row }

    const reason = error.message ?? error.code ?? 'Unknown tracking event error'
    if (error.code === '42P01' || error.code === 'PGRST205') {
      console.error('[ppc/tracking-events] table missing; migration has not been applied yet', reason)
    } else {
      console.error('[ppc/tracking-events] insert failed', error)
    }
    return { recorded: false, row, reason }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[ppc/tracking-events] insert threw', error)
    return { recorded: false, row, reason }
  }
}
