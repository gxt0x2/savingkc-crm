interface InboundSmsLead {
  id: string
  full_name: string | null
  phone: string
  station: string | null
  priority: string | null
}

export type InboundSmsLeadResolution = {
  kind: 'normalized_phone' | 'outbound_thread'
  candidateCount: number
  lead: InboundSmsLead
  matchedOutboundActivityId: string | null
} | {
  kind: 'unknown' | 'ambiguous' | 'unsupported'
  candidateCount: number
  lead: null
  matchedOutboundActivityId: null
}

type IdentityDatabase = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** No raw-phone fallback: migration lag or uncertain identity must fail safely. */
export async function resolveInboundSmsLead(
  db: IdentityDatabase,
  customerPhone: string,
  companyPhone: string,
  receivedAt: string,
): Promise<InboundSmsLeadResolution> {
  const { data, error } = await db.rpc('resolve_inbound_sms_lead_v1', {
    p_customer_phone: customerPhone,
    p_company_phone: companyPhone,
    p_received_at: receivedAt,
  })
  if (error) throw new Error(`Inbound SMS identity resolution failed: ${error.message}`)
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
    throw new Error('Inbound SMS identity resolution returned no unique result')
  }
  const row = data[0] as Record<string, unknown>
  const count = typeof row.candidate_count === 'number' || (typeof row.candidate_count === 'string' && /^\d+$/.test(row.candidate_count))
    ? Number(row.candidate_count) : Number.NaN
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Inbound SMS identity resolution returned invalid candidate count')
  if (((row.resolution === 'unknown' || row.resolution === 'unsupported') && count === 0) || (row.resolution === 'ambiguous' && count > 1)) {
    if (row.lead_id !== null || row.matched_outbound_activity_id !== null) throw new Error('Inbound SMS identity resolution returned an unresolved contact')
    return { kind: row.resolution, candidateCount: count, lead: null, matchedOutboundActivityId: null }
  }
  if (((row.resolution === 'normalized_phone' && count === 1) || (row.resolution === 'outbound_thread' && count > 1))
    && typeof row.lead_id === 'string' && row.lead_id.trim()
    && typeof row.phone === 'string' && row.phone.trim()
    && (row.resolution !== 'outbound_thread' || (typeof row.matched_outbound_activity_id === 'string' && row.matched_outbound_activity_id.trim()))) {
    return {
      kind: row.resolution,
      candidateCount: count,
      lead: {
        id: row.lead_id,
        full_name: typeof row.full_name === 'string' ? row.full_name : null,
        phone: row.phone,
        station: typeof row.station === 'string' ? row.station : null,
        priority: typeof row.priority === 'string' ? row.priority : null,
      },
      matchedOutboundActivityId: typeof row.matched_outbound_activity_id === 'string' ? row.matched_outbound_activity_id : null,
    }
  }
  throw new Error('Inbound SMS identity resolution returned an invalid result')
}
