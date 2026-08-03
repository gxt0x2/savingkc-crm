export type DirectInboundLeadSeedInput = {
  phone: string
  displayPhone: string
  assignedAgent: string
  calledNumber: string
  callSid: string
}

/**
 * A connected call proves communication, not seller qualification. Unknown
 * callers enter New with an owner and an explicit qualification action.
 */
export function buildDirectInboundLeadSeed(input: DirectInboundLeadSeedInput) {
  return {
    full_name: `New caller · ${input.displayPhone}`,
    phone: input.phone,
    source: 'inbound_call',
    station: 'new',
    priority: 'warm',
    classification: null,
    assigned_agent: input.assignedAgent,
    notes: `Connected inbound call to ${input.calledNumber}. Seller status has not been qualified.`,
  }
}

export function buildDirectInboundQualificationTask(input: DirectInboundLeadSeedInput) {
  return {
    activity_type: 'task',
    description: `Qualify new caller ${input.displayPhone}`,
    agent: 'System',
    metadata: {
      source: 'direct_inbound_intake',
      call_sid: input.callSid,
      task_type: 'qualification',
      due_date: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      assigned_to: input.assignedAgent,
      priority: 'high',
      status: 'pending',
    },
  }
}
