import { normalizeEmailAddress } from '@/lib/email/identity'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type ManualEmailConsentFields = {
  email_opt_out?: boolean
  email_suppressed?: boolean
  email_consent?: 'clear' | 'opted_in' | 'subscribed' | 'opted_out' | 'suppressed' | 'unknown'
}

export type ManualEmailSendDecision =
  | { ok: true; to: string }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

const BLOCKING_PERSON_RULES = new Set(['stopped', 'deceased_reported', 'deceased_confirmed'])
const CLEAR_CONSENT = new Set(['clear', 'opted_in', 'subscribed'])

type QueryResult<T> = { data: T[] | null; error: { message?: string } | null }

export type ManualEmailConsentLookup = {
  loadLead: (leadId: string) => Promise<{ email: string | null } | null | 'error'>
  loadAddresses: (normalized: string[]) => Promise<QueryResult<{ id: string; normalized_address: string }>>
  loadSuppressions: (addressIds: string[]) => Promise<QueryResult<{ address_id: string }>>
  loadParties: (leadIds: string[]) => Promise<QueryResult<{ id: string; lead_id: string }>>
  loadRules: (partyIds: string[]) => Promise<QueryResult<{ party_id: string; status: string }>>
}

function explicitClear(fields: ManualEmailConsentFields): boolean {
  const consent = fields.email_consent ?? ''
  if (fields.email_opt_out === true || fields.email_suppressed === true) return false
  if (/opted_out|unsubscribed|suppressed/.test(consent)) return false
  return fields.email_opt_out === false
    && fields.email_suppressed === false
    && CLEAR_CONSENT.has(consent)
}

export function manualEmailConsentFields(input: {
  addressLookup: 'clear' | 'suppressed' | 'unknown'
  personRule: 'none' | 'blocked' | 'unknown'
}): ManualEmailConsentFields {
  if (input.addressLookup === 'unknown' || input.personRule === 'unknown') {
    return { email_consent: 'unknown' }
  }
  if (input.personRule === 'blocked' && input.addressLookup === 'suppressed') {
    return { email_opt_out: true, email_suppressed: true, email_consent: 'opted_out' }
  }
  if (input.personRule === 'blocked') {
    return { email_opt_out: true, email_suppressed: false, email_consent: 'opted_out' }
  }
  if (input.addressLookup === 'suppressed') {
    return { email_opt_out: false, email_suppressed: true, email_consent: 'suppressed' }
  }
  return { email_opt_out: false, email_suppressed: false, email_consent: 'clear' }
}

function readableRows<T>(result: QueryResult<T> | null | undefined): T[] | 'error' {
  if (!result || typeof result !== 'object' || !('data' in result) || !('error' in result)) return 'error'
  if (result.error) return 'error'
  if (!Array.isArray(result.data)) return 'error'
  return result.data
}

export async function manualEmailConsentForLeads(
  leads: Array<{ id: string; email?: string | null }>,
  lookup: ManualEmailConsentLookup = defaultManualEmailConsentLookup(),
): Promise<Map<string, ManualEmailConsentFields>> {
  const fields = new Map<string, ManualEmailConsentFields>()
  const targets = leads.flatMap((lead) => {
    const email = typeof lead.email === 'string' ? normalizeEmailAddress(lead.email) : null
    return email ? [{ id: lead.id, email }] : []
  })
  if (targets.length === 0) return fields

  const normalized = [...new Set(targets.map((lead) => lead.email))]
  type AddressRow = { id: string; normalized_address: string }
  type PartyRow = { id: string; lead_id: string }
  let addresses: AddressRow[] | 'error'
  let parties: PartyRow[] | 'error'
  let stopped: Array<{ address_id: string }> | 'error'
  let personRules: Array<{ party_id: string; status: string }> | 'error'
  try {
    addresses = readableRows(await lookup.loadAddresses(normalized))
    parties = readableRows(await lookup.loadParties(targets.map((lead) => lead.id)))
    if (addresses === 'error' || parties === 'error') {
      for (const lead of targets) fields.set(lead.id, { email_consent: 'unknown' })
      return fields
    }

    const addressIds = addresses.map((row) => row.id).filter(Boolean)
    const partyIds = parties.map((row) => row.id).filter(Boolean)
    const [suppressions, rules] = await Promise.all([
      addressIds.length ? lookup.loadSuppressions(addressIds) : Promise.resolve({ data: [], error: null }),
      partyIds.length ? lookup.loadRules(partyIds) : Promise.resolve({ data: [], error: null }),
    ])
    stopped = readableRows(suppressions)
    personRules = readableRows(rules)
  } catch {
    for (const lead of targets) fields.set(lead.id, { email_consent: 'unknown' })
    return fields
  }
  if (stopped === 'error' || personRules === 'error') {
    for (const lead of targets) fields.set(lead.id, { email_consent: 'unknown' })
    return fields
  }

  const suppressedAddresses = new Set(stopped.map((row) => row.address_id))
  const suppressedEmails = new Set(addresses
    .filter((row) => suppressedAddresses.has(row.id))
    .map((row) => row.normalized_address))
  const rulesByParty = new Map<string, string[]>()
  for (const rule of personRules) {
    rulesByParty.set(rule.party_id, [...(rulesByParty.get(rule.party_id) ?? []), rule.status])
  }

  for (const lead of targets) {
    const statuses = parties
      .filter((party) => party.lead_id === lead.id)
      .flatMap((party) => rulesByParty.get(party.id) ?? [])
    if (statuses.some((status) => !BLOCKING_PERSON_RULES.has(status))) {
      fields.set(lead.id, { email_consent: 'unknown' })
      continue
    }
    fields.set(lead.id, manualEmailConsentFields({
      addressLookup: suppressedEmails.has(lead.email) ? 'suppressed' : 'clear',
      personRule: statuses.length > 0 ? 'blocked' : 'none',
    }))
  }
  return fields
}

export async function attachManualEmailConsent<T extends { id: string; email?: string | null }>(
  records: T[],
): Promise<Array<T & ManualEmailConsentFields>> {
  const fields = await manualEmailConsentForLeads(records)
  return records.map((record) => ({ ...record, ...fields.get(record.id) }))
}

export async function assertManualLeadEmailSend(input: {
  leadId: string | null
  to: string
  lookup?: ManualEmailConsentLookup
}): Promise<ManualEmailSendDecision> {
  const leadId = input.leadId?.trim() ?? ''
  const requested = input.to.trim()
  if (!leadId) {
    return { ok: false, status: 400, code: 'lead_required', error: 'Manual email requires the stored lead.' }
  }
  if (!requested || /[;,]/.test(requested)) {
    return { ok: false, status: 400, code: 'bulk_email_locked', error: 'Bulk email stays locked. Send one stored lead address.' }
  }
  const lookup = input.lookup ?? defaultManualEmailConsentLookup()
  const lead = await lookup.loadLead(leadId)
  if (lead === 'error') {
    return { ok: false, status: 409, code: 'email_consent_unknown', error: 'Email suppression status could not be confirmed, so this send was not attempted.' }
  }
  if (!lead) return { ok: false, status: 404, code: 'lead_not_found', error: 'Lead not found.' }
  const stored = lead.email ? normalizeEmailAddress(lead.email) : null
  const recipient = normalizeEmailAddress(requested)
  if (!stored || !recipient || stored !== recipient) {
    return { ok: false, status: 400, code: 'recipient_mismatch', error: 'The recipient must be the email stored on this lead.' }
  }
  const consent = await manualEmailConsentForLeads([{ id: leadId, email: stored }], lookup)
  const fields = consent.get(leadId) ?? { email_consent: 'unknown' as const }
  if (!explicitClear(fields)) {
    const suppressed = fields.email_suppressed === true || fields.email_consent === 'suppressed'
    const optedOut = fields.email_opt_out === true || fields.email_consent === 'opted_out'
    return {
      ok: false,
      status: 409,
      code: suppressed ? 'email_suppressed' : optedOut ? 'email_opt_out' : 'email_consent_unknown',
      error: suppressed || optedOut
        ? 'This address is stopped for email. The send was not attempted.'
        : 'Email suppression status is unknown, so this send was not attempted.',
    }
  }
  return { ok: true, to: stored }
}

function rows<T>(result: { data: T[] | null; error: { message?: string } | null }): QueryResult<T> {
  return { data: result.data, error: result.error }
}

export function defaultManualEmailConsentLookup(): ManualEmailConsentLookup {
  const db = () => supabaseAdmin()
  return {
    async loadLead(leadId) {
      const { data, error } = await db().from('leads').select('email').eq('id', leadId).maybeSingle<{ email: string | null }>()
      if (error) return 'error'
      return data ?? null
    },
    async loadAddresses(normalized) {
      const result = await db().from('em_addresses').select('id, normalized_address').in('normalized_address', normalized)
      return rows(result)
    },
    async loadSuppressions(addressIds) {
      const result = await db().from('em_suppressions').select('address_id').in('address_id', addressIds)
      return rows(result)
    },
    async loadParties(leadIds) {
      const result = await db().from('em_parties').select('id, lead_id').in('lead_id', leadIds)
      return rows(result)
    },
    async loadRules(partyIds) {
      const result = await db().from('em_person_marketing_rules').select('party_id, status').in('party_id', partyIds)
      return rows(result)
    },
  }
}
