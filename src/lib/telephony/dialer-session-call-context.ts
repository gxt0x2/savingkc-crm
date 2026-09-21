export const SESSION_CALL_CONTEXT_MISMATCH_MESSAGE = 'Call context does not match the active session'
export const PROSPECTING_DIALER_RESET_CALL_CONTEXT_EVENT = 'prospecting-dialer-reset-call-context'

export type SessionCallContext = {
  currentSubjectKind: string | null
  currentSubjectId: string | null
  currentCampaignMemberId: string | null
}

export type ProspectingCallContext = {
  kind: string
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
}

export function queueItemCallContext(item: {
  leadId: string | null
  prospectId: string | null
  prospect_phone_id: string | null
  campaignMemberId: string | null
}): ProspectingCallContext {
  const kind = item.leadId
    ? item.prospect_phone_id ? 'heir' : 'lead'
    : 'prospect'
  return {
    kind,
    leadId: kind === 'lead' || kind === 'heir' ? item.leadId : null,
    prospectId: kind === 'prospect' ? item.prospectId : null,
    campaignMemberId: item.campaignMemberId,
  }
}

export function prospectingCallMatchesSession(
  session: SessionCallContext,
  call: ProspectingCallContext,
): boolean {
  const kindMatches = session.currentSubjectKind === call.kind
    || (session.currentSubjectKind === 'lead' && call.kind === 'heir')
  if (!kindMatches) return false

  const requestedSubjectId = session.currentSubjectKind === 'prospect' ? call.prospectId : call.leadId
  if (!session.currentSubjectId || session.currentSubjectId !== requestedSubjectId) return false

  return (session.currentCampaignMemberId || null) === (call.campaignMemberId || null)
}
