import type { MojoCallRecord } from '@/lib/server/mojo-call-import'

export const MOJO_FIELD_OWNERSHIP_VERSION = 'mojo_field_ownership_v1' as const

export const MOJO_FIELD_OWNERSHIP = {
  providerEvidence: [
    'record_id',
    'call_date',
    'call_duration',
    'disposition',
    'agent_name',
    'notes',
    'recording_url',
    'follow_up_date',
    'list_name',
    'campaign_name',
  ],
  identityFillOnly: ['full_name', 'phone', 'email'],
  operationalSnapshot: ['mojo_record_id', 'call_result', 'call_duration_seconds'],
  commandOnly: ['assigned_agent', 'station', 'dead_reason', 'appointment', 'work_item', 'dnc'],
  canonicalOnly: [
    'source',
    'source_list',
    'county',
    'tax_delinquent',
    'tax_delinquent_years',
    'cumulative_due',
    'deceased',
    'property_address',
    'city',
    'state',
    'zip',
    'property_type',
    'assessed_value',
    'market_value',
    'bedrooms',
    'bathrooms',
    'square_feet',
    'lot_size',
    'year_built',
    'occupancy',
  ],
} as const

export type MojoLeadSnapshot = {
  full_name?: string | null
  phone?: string | null
  email?: string | null
}

export type MojoApprovedLeadPatch = {
  full_name?: string
  phone?: string
  email?: string
  mojo_record_id: string
  call_result: string
  call_duration_seconds: number
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function placeholderName(value: string): boolean {
  const normalized = value.toLowerCase()
  return !normalized || normalized === 'unknown' || normalized === 'mojo lead' || normalized.startsWith('caller (')
}

export function projectApprovedMojoLeadPatch(
  current: MojoLeadSnapshot,
  call: Pick<MojoCallRecord, 'record_id' | 'contact_name' | 'phone_number' | 'email' | 'disposition' | 'call_duration'>,
  options: { latestForLead: boolean },
): MojoApprovedLeadPatch | Record<string, never> {
  if (!options.latestForLead) return {}

  const patch: MojoApprovedLeadPatch = {
    mojo_record_id: call.record_id,
    call_result: call.disposition,
    call_duration_seconds: Math.max(0, Math.trunc(call.call_duration)),
  }
  const currentName = clean(current.full_name)
  const providerName = clean(call.contact_name)
  if (placeholderName(currentName) && !placeholderName(providerName)) patch.full_name = providerName

  const providerPhone = clean(call.phone_number)
  if (!clean(current.phone) && providerPhone) patch.phone = providerPhone

  const providerEmail = clean(call.email).toLowerCase()
  if (!clean(current.email) && providerEmail) patch.email = providerEmail

  return patch
}
