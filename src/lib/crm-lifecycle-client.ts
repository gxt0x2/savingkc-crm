import type { DealStage } from '@/types/pipeline'

export async function transitionLeadLifecycle(
  leadId: string,
  input: {
    stage: DealStage
    deadReason?: string | null
    deadReasonNotes?: string | null
    reason?: string | null
  },
) {
  const response = await fetch(`/api/leads/${leadId}/lifecycle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'transition', ...input }),
  })
  const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
  if (!response.ok || !payload.success) throw new Error(payload.error || 'Lifecycle status could not be updated.')
  return payload
}
