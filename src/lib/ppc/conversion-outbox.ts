import { supabase } from '@/lib/supabase-lazy'
import type { CallQualityEventName } from '@/lib/call-quality-events'

export type PpcConversionEventName =
  | 'lead_stage3_completed'
  | 'lead_submitted'
  | 'appointment_booked'
  | CallQualityEventName

export type PpcConversionCategory = 'form' | 'call' | 'appointment' | 'phone'
export type PpcOptimizationRole = 'primary' | 'secondary' | 'diagnostic'
export type PpcClickIdType = 'gclid' | 'gbraid' | 'wbraid'

export type PpcConversionAttribution = Record<string, unknown>

export type EnqueuePpcConversionInput = {
  eventName: PpcConversionEventName
  eventCategory: PpcConversionCategory
  dedupeKey: string
  leadId?: string | null
  manifestId?: string | null
  activityId?: string | null
  destination?: 'google_ads'
  optimizationRole?: PpcOptimizationRole
  conversionValue?: number | null
  currency?: string
  eventTime?: string | Date
  attribution?: PpcConversionAttribution | null
  payload?: Record<string, unknown> | null
}

export type PpcConversionOutboxRow = {
  event_name: PpcConversionEventName
  event_category: PpcConversionCategory
  destination: 'google_ads'
  dedupe_key: string
  optimization_role: PpcOptimizationRole
  lead_id: string | null
  manifest_id: string | null
  activity_id: string | null
  conversion_value: number | null
  currency: string
  event_time: string
  click_id: string | null
  click_id_type: PpcClickIdType | null
  attribution: Record<string, unknown>
  payload: Record<string, unknown>
}

type OutboxError = {
  code?: string
  message?: string
}

type OutboxTable = {
  upsert: (
    row: PpcConversionOutboxRow,
    options: { onConflict: string; ignoreDuplicates: boolean },
  ) => PromiseLike<{ error: OutboxError | null }>
}

type OutboxClient = {
  from: (table: string) => OutboxTable
}

export type EnqueuePpcConversionResult =
  | { queued: true; row: PpcConversionOutboxRow }
  | { queued: false; row: PpcConversionOutboxRow; reason: string }

function cleanJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanJsonValue(item))
      .filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    return cleanJsonRecord(value as Record<string, unknown>)
  }
  return value
}

export function cleanJsonRecord(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    const cleanValue = cleanJsonValue(value)
    if (cleanValue !== undefined) output[key] = cleanValue
  }
  return output
}

function readClickId(attribution: PpcConversionAttribution | null | undefined, key: PpcClickIdType): string | null {
  const value = attribution?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function pickBestClickId(
  attribution: PpcConversionAttribution | null | undefined,
): { clickId: string | null; clickIdType: PpcClickIdType | null } {
  const gclid = readClickId(attribution, 'gclid')
  if (gclid) return { clickId: gclid, clickIdType: 'gclid' }

  const gbraid = readClickId(attribution, 'gbraid')
  if (gbraid) return { clickId: gbraid, clickIdType: 'gbraid' }

  const wbraid = readClickId(attribution, 'wbraid')
  if (wbraid) return { clickId: wbraid, clickIdType: 'wbraid' }

  return { clickId: null, clickIdType: null }
}

function normalizeEventTime(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
}

export function buildPpcConversionOutboxRow(input: EnqueuePpcConversionInput): PpcConversionOutboxRow {
  const attribution = cleanJsonRecord(input.attribution)
  const { clickId, clickIdType } = pickBestClickId(attribution)
  const optimizationRole = input.optimizationRole ?? 'secondary'

  return {
    event_name: input.eventName,
    event_category: input.eventCategory,
    destination: input.destination ?? 'google_ads',
    dedupe_key: input.dedupeKey,
    optimization_role: optimizationRole,
    lead_id: input.leadId ?? null,
    manifest_id: input.manifestId ?? null,
    activity_id: input.activityId ?? null,
    conversion_value: input.conversionValue ?? null,
    currency: input.currency ?? 'USD',
    event_time: normalizeEventTime(input.eventTime),
    click_id: clickId,
    click_id_type: clickIdType,
    attribution,
    payload: cleanJsonRecord({
      traffic_source: 'google_ads',
      campaign: 'Search 2026',
      optimization_role: optimizationRole,
      ...(input.payload ?? {}),
    }),
  }
}

export async function enqueuePpcConversion(
  input: EnqueuePpcConversionInput,
  client: OutboxClient = supabase as unknown as OutboxClient,
): Promise<EnqueuePpcConversionResult> {
  const row = buildPpcConversionOutboxRow(input)

  try {
    const { error } = await client.from('ppc_conversion_outbox').upsert(row, {
      onConflict: 'destination,event_name,dedupe_key',
      ignoreDuplicates: true,
    })

    if (!error) return { queued: true, row }

    const reason = error.message ?? error.code ?? 'Unknown outbox error'
    if (error.code === '42P01' || error.code === 'PGRST205') {
      console.error('[ppc/conversion-outbox] table missing; migration has not been applied yet', reason)
    } else {
      console.error('[ppc/conversion-outbox] enqueue failed', error)
    }
    return { queued: false, row, reason }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[ppc/conversion-outbox] enqueue threw', error)
    return { queued: false, row, reason }
  }
}
