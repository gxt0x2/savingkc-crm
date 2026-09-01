import type { DealStage } from '@/types/pipeline'
import { withDialerSessionControlOperation } from '@/lib/telephony/dialer-control-operation-client'

export async function transitionLeadLifecycle(
  leadId: string,
  input: {
    stage: DealStage
    deadReason?: string | null
    deadReasonNotes?: string | null
    reason?: string | null
    dialerSessionId?: string | null
  },
) {
  const response = await withDialerSessionControlOperation(input.dialerSessionId, 'Marking lead dead', (controlHeaders, signal) => fetch(`/api/leads/${leadId}/lifecycle`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...controlHeaders },
    body: JSON.stringify({ action: 'transition', ...input }),
  }))
  const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
  if (!response.ok || !payload.success) throw new Error(payload.error || 'Lifecycle status could not be updated.')
  return payload
}
