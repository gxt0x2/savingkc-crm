import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import type { supabaseAdmin } from '@/lib/supabase/admin'
import {
  CALLER_ID_REST_COMPLIANCE,
  CALLER_ID_STATUSES,
  chicagoDayBounds,
  mojoDialConnected,
  twilioDialConnected,
  type CallerIdDial,
  type CallerIdHealthAction,
  type CallerIdRecord,
  type CallerIdStatus,
} from './caller-id-health'
import type { CallerIdDialLoad, CallerIdHealthStore } from './caller-id-health-run'

type Db = ReturnType<typeof supabaseAdmin>
const PAGE = 1000
const MAX_ROWS = 20_000

type MojoRow = {
  id: string
  caller_id: string | null
  call_at: string
  duration_seconds: number | null
  result_label: string | null
  result_code: number | null
}

type TwilioRow = {
  id: string
  created_at: string
  metadata: unknown
}

export function mojoRowToDial(row: MojoRow): CallerIdDial | null {
  const callerId = normalizePhoneToE164(row.caller_id)
  if (!callerId || !row.call_at) return null
  const duration = Number(row.duration_seconds ?? 0)
  return {
    callerId,
    at: row.call_at,
    connected: mojoDialConnected(row.result_label, row.result_code, Number.isFinite(duration) ? duration : 0),
    source: 'mojo',
  }
}

export function twilioRowToDial(row: TwilioRow): CallerIdDial | null {
  if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return null
  const metadata = row.metadata as Record<string, unknown>
  if (metadata.source !== 'twilio_status_callback' || metadata.direction !== 'outbound') return null
  const callerId = normalizePhoneToE164(typeof metadata.from === 'string' ? metadata.from : '')
  if (!callerId || !row.created_at) return null
  const duration = typeof metadata.duration === 'number' ? metadata.duration : Number(metadata.duration ?? 0)
  const status = typeof metadata.status === 'string' ? metadata.status : ''
  return {
    callerId,
    at: row.created_at,
    connected: twilioDialConnected(status, Number.isFinite(duration) ? duration : 0),
    source: 'twilio',
  }
}

async function readPages<T>(read: (from: number, to: number) => Promise<T[]>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const batch = await read(from, from + PAGE - 1)
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

function statusOf(value: string): CallerIdStatus | null {
  return (CALLER_ID_STATUSES as readonly string[]).includes(value) ? value as CallerIdStatus : null
}

export function callerIdHealthStore(db: Db): CallerIdHealthStore {
  return {
    async loadNumbers() {
      const { data, error } = await db
        .from('caller_ids')
        .select('phone_e164, area_code, status, rest_until, rest_reason')
        .order('phone_e164', { ascending: true })
      if (error) throw new Error('caller_ids_unreadable')
      const numbers: CallerIdRecord[] = []
      for (const row of data ?? []) {
        const status = statusOf(String(row.status ?? ''))
        if (!status || typeof row.phone_e164 !== 'string' || typeof row.area_code !== 'string') continue
        numbers.push({
          number: row.phone_e164,
          areaCode: row.area_code,
          status,
          restUntil: typeof row.rest_until === 'string' ? row.rest_until : null,
          restReason: typeof row.rest_reason === 'string' ? row.rest_reason : null,
        })
      }
      return numbers
    },
    async loadDials(sinceIso) {
      const mojo = await readPages<MojoRow>(async (from, to) => {
        const { data, error } = await db
          .from('crm_mojo_calls')
          .select('id, caller_id, call_at, duration_seconds, result_label, result_code')
          .gte('call_at', sinceIso)
          .not('caller_id', 'is', null)
          .order('call_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (error) throw new Error('mojo_caller_id_dials_unreadable')
        return (data ?? []) as MojoRow[]
      })
      const twilio = await readPages<TwilioRow>(async (from, to) => {
        const { data, error } = await db
          .from('lead_activities')
          .select('id, created_at, metadata')
          .eq('activity_type', 'call')
          .eq('metadata->>source', 'twilio_status_callback')
          .eq('metadata->>direction', 'outbound')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (error) throw new Error('twilio_caller_id_dials_unreadable')
        return (data ?? []) as TwilioRow[]
      })
      const dials = [
        ...mojo.rows.map(mojoRowToDial),
        ...twilio.rows.map(twilioRowToDial),
      ].filter((dial): dial is CallerIdDial => dial != null)
      return { dials, truncated: mojo.truncated || twilio.truncated } satisfies CallerIdDialLoad
    },
    async apply(actions, chicagoDate) {
      const bounds = chicagoDayBounds(chicagoDate)
      for (const action of actions) await applyAction(db, action, bounds)
      await insertEvent(db, {
        phone_e164: null,
        event_type: 'run',
        reason: CALLER_ID_REST_COMPLIANCE,
        metrics: { chicagoDate, actions: actions.map((action) => ({ type: action.type, number: action.number })) },
      }, bounds, true)
      const { data, error } = await db.from('caller_ids').select('phone_e164').eq('status', 'active').order('phone_e164')
      if (error) throw new Error('caller_ids_unreadable')
      return (data ?? []).map((row) => String(row.phone_e164)).filter((phone) => phone.startsWith('+1'))
    },
  }
}

async function applyAction(db: Db, action: CallerIdHealthAction, bounds: { start: string; end: string }): Promise<void> {
  if (action.type === 'rest') {
    const { data, error } = await db
      .from('caller_ids')
      .update({
        status: 'resting',
        rest_until: action.restUntil,
        rest_reason: action.reason,
        metrics_snapshot: action.metrics,
        updated_at: new Date().toISOString(),
      })
      .eq('phone_e164', action.number)
      .eq('status', 'active')
      .select('id')
    if (error) throw new Error('caller_id_rest_failed')
    if ((data ?? []).length > 0) await insertEvent(db, eventRow(action), bounds, true)
    return
  }
  if (action.type === 'promote') {
    const { data, error } = await db
      .from('caller_ids')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('phone_e164', action.number)
      .eq('status', 'spare')
      .select('id')
    if (error) throw new Error('caller_id_promote_failed')
    if ((data ?? []).length > 0) await insertEvent(db, eventRow(action), bounds, true)
    return
  }
  await insertEvent(db, eventRow(action), bounds, true)
}

function eventRow(action: CallerIdHealthAction): { phone_e164: string; event_type: string; reason: string; metrics: unknown } {
  if (action.type === 'rest') {
    return { phone_e164: action.number, event_type: 'rest', reason: action.reason, metrics: { ...action.metrics, restUntil: action.restUntil } }
  }
  if (action.type === 'cap_note') return { phone_e164: action.number, event_type: 'cap_note', reason: action.reason, metrics: action.metrics }
  if (action.type === 'promote') {
    return { phone_e164: action.number, event_type: 'promote', reason: action.reason, metrics: { areaCode: action.areaCode, replaces: action.replaces } }
  }
  if (action.type === 'rest_confirmed') {
    return { phone_e164: action.number, event_type: 'rest_confirmed', reason: action.reason, metrics: action.metrics }
  }
  return { phone_e164: action.number, event_type: 'rest_elapsed_needs_clearance', reason: action.reason, metrics: { restUntil: action.restUntil } }
}

async function insertEvent(
  db: Db,
  row: { phone_e164: string | null; event_type: string; reason: string; metrics: unknown },
  bounds: { start: string; end: string },
  once: boolean,
): Promise<void> {
  if (once) {
    let query = db
      .from('caller_id_health_events')
      .select('id')
      .eq('event_type', row.event_type)
      .gte('created_at', bounds.start)
      .lt('created_at', bounds.end)
      .limit(1)
    query = row.phone_e164 ? query.eq('phone_e164', row.phone_e164) : query.is('phone_e164', null)
    const { data, error } = await query
    if (error) throw new Error('caller_id_health_event_unreadable')
    if ((data ?? []).length > 0) return
  }
  const { error } = await db.from('caller_id_health_events').insert({
    phone_e164: row.phone_e164,
    event_type: row.event_type,
    reason: row.reason,
    metrics: row.metrics,
  })
  if (error) throw new Error('caller_id_health_event_failed')
}
