export type DirectInboundLeadSeedInput = {
  phone: string
  displayPhone: string
  assignedAgent: string
  calledNumber: string
  callSid: string
}

/** A connected call proves communication, not seller qualification. */
export function buildDirectInboundLeadSeed(input: DirectInboundLeadSeedInput) {
  return {
    full_name: `New caller · ${input.displayPhone}`,
    phone: input.phone,
    source: 'inbound_call',
    station: 'new',
    priority: 'warm',
    classification: null,
    assigned_agent: input.assignedAgent,
    notes: `Connected inbound call to ${input.calledNumber}. The seller has not been confirmed as an opportunity.`,
  }
}
