import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { mapMojoDisposition, type MojoCallRecord } from '@/lib/server/mojo-call-import'
import { MOJO_FIELD_OWNERSHIP_VERSION, projectApprovedMojoLeadPatch } from './mojo-field-ownership'

export type MojoReconciliationLead = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  source: string | null
  mojo_record_id: string | null
  call_result: string | null
  call_duration_seconds: number | null
  station: string | null
  assigned_agent: string | null
}

export type MojoReconciliationProspectPhone = {
  phone: string | null
  leadId: string | null
}

export type MojoExistingEvent = {
  recordId: string
  leadId: string | null
  callAt: string
}

const CREATES_IDENTITY = new Set(['callback_scheduled', 'meaningful_conversation', 'appointment_set'])
const TERMINAL_STATIONS = new Set(['offer_made', 'under_contract', 'closed_won', 'closed_lost', 'dead'])

export function mojoCentralDate(value: string): string | null {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ''
  const result = `${part('year')}-${part('month')}-${part('day')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function governedCommands(lead: MojoReconciliationLead, call: MojoCallRecord): string[] {
  const commands: string[] = []
  const outcome = mapMojoDisposition(call.disposition)
  const station = clean(lead.station).toLowerCase() || 'new'
  const terminal = TERMINAL_STATIONS.has(station)

  if (!clean(lead.assigned_agent) && !terminal) commands.push('assignment')
  if (outcome === 'dnc') commands.push('dnc_suppression')
  if (outcome === 'appointment_set' && clean(call.follow_up_date)) commands.push('appointment')
  if (['callback_scheduled', 'meaningful_conversation'].includes(outcome) && clean(call.follow_up_date)) {
    commands.push('follow_up')
  }
  if (!terminal && (
    ['not_interested', 'already_sold', 'dnc'].includes(outcome)
    || (outcome === 'appointment_set' && clean(call.follow_up_date))
    || (station === 'new' && ['meaningful_conversation', 'callback_scheduled'].includes(outcome))
  )) commands.push('lifecycle_transition')

  return commands
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function differs(providerValue: string | undefined, crmValue: string | null): boolean {
  return Boolean(clean(providerValue)) && clean(providerValue).toLowerCase() !== clean(crmValue).toLowerCase()
}

export function reconcileMojoCalls(input: {
  calls: MojoCallRecord[]
  leads: MojoReconciliationLead[]
  prospectPhones: MojoReconciliationProspectPhone[]
  existingEvents: MojoExistingEvent[]
}) {
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]))
  const candidatesByPhone = new Map<string, Set<string>>()
  const addCandidate = (phone: string | null, leadId: string | null) => {
    const normalized = normalizePhoneToE164(phone || '')
    if (!normalized || !leadId || !leadById.has(leadId)) return
    const ids = candidatesByPhone.get(normalized) ?? new Set<string>()
    ids.add(leadId)
    candidatesByPhone.set(normalized, ids)
  }
  for (const lead of input.leads) addCandidate(lead.phone, lead.id)
  for (const phone of input.prospectPhones) addCandidate(phone.phone, phone.leadId)

  const existingIds = new Set(input.existingEvents.map((event) => event.recordId))
  const latestAtByLead = new Map<string, number>()
  for (const event of input.existingEvents) {
    if (!event.leadId) continue
    latestAtByLead.set(event.leadId, Math.max(latestAtByLead.get(event.leadId) ?? 0, Date.parse(event.callAt) || 0))
  }

  const matched = new Map<number, string>()
  const summary = {
    sourceRows: input.calls.length,
    alreadyPresent: 0,
    newProviderEvents: 0,
    matched: 0,
    ambiguous: 0,
    invalidPhone: 0,
    unknownContact: 0,
    wouldCreateIdentityShell: 0,
    leadPatches: 0,
    leadPatchFields: {} as Record<string, number>,
    eligibleOutcomeCounts: {} as Record<string, number>,
    governedCommandCandidates: {} as Record<string, number>,
    blockedCanonicalDiffs: {} as Record<string, number>,
    protectedWrites: 0,
  }

  input.calls.forEach((call, index) => {
    if (existingIds.has(call.record_id)) {
      summary.alreadyPresent++
      return
    }
    summary.newProviderEvents++
    const phone = normalizePhoneToE164(call.phone_number)
    if (!phone) {
      summary.invalidPhone++
      return
    }
    const candidates = [...(candidatesByPhone.get(phone) ?? [])]
    if (candidates.length > 1) {
      summary.ambiguous++
      return
    }
    if (candidates.length === 0) {
      const outcome = mapMojoDisposition(call.disposition)
      if (CREATES_IDENTITY.has(outcome) && clean(call.contact_name) && !['unknown', 'mojo lead'].includes(clean(call.contact_name).toLowerCase())) {
        summary.wouldCreateIdentityShell++
      } else {
        summary.unknownContact++
      }
      return
    }
    const leadId = candidates[0]
    matched.set(index, leadId)
    summary.matched++
    latestAtByLead.set(leadId, Math.max(latestAtByLead.get(leadId) ?? 0, Date.parse(call.call_date) || 0))
  })

  matched.forEach((leadId, index) => {
    const call = input.calls[index]
    const lead = leadById.get(leadId)
    if (!lead) return
    increment(summary.eligibleOutcomeCounts, mapMojoDisposition(call.disposition))
    for (const command of governedCommands(lead, call)) increment(summary.governedCommandCandidates, command)
    const latestForLead = (Date.parse(call.call_date) || 0) >= (latestAtByLead.get(leadId) ?? 0)
    const patch = projectApprovedMojoLeadPatch(lead, call, { latestForLead })
    let changed = false
    for (const [field, value] of Object.entries(patch)) {
      if (String(lead[field as keyof MojoReconciliationLead] ?? '') === String(value ?? '')) continue
      summary.leadPatchFields[field] = (summary.leadPatchFields[field] ?? 0) + 1
      changed = true
    }
    if (changed) summary.leadPatches++

    for (const field of ['property_address', 'city', 'state', 'zip'] as const) {
      if (!differs(call[field], lead[field])) continue
      summary.blockedCanonicalDiffs[field] = (summary.blockedCanonicalDiffs[field] ?? 0) + 1
    }
    if (clean(call.list_name) || clean(call.campaign_name)) {
      summary.blockedCanonicalDiffs.source = (summary.blockedCanonicalDiffs.source ?? 0) + 1
    }
  })

  return {
    policyVersion: MOJO_FIELD_OWNERSHIP_VERSION,
    eligibleRecordIds: [...matched.keys()].map((index) => input.calls[index].record_id).sort(),
    summary,
  }
}
