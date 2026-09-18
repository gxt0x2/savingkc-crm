import type { Heir } from '@/lib/heir-dialer-queue'
import { evaluateOutboundDialerCall } from './dialer-call-eligibility'

// Enrollment snapshots preserve the reviewed audience, but are not current
// permission to call. Apply the same live policy used by call authorization
// without rewriting those snapshots or creating call/activity records.
export async function applyCampaignContactCallPolicy(
  groups: Heir[],
  subject: { leadId: string | null; prospectId: string | null },
): Promise<Heir[]> {
  const result = groups.map((group) => ({ ...group, phones: group.phones.map((phone) => ({ ...phone })) }))
  const phones = result.flatMap((group) => group.phones).filter((phone) => phone.status === 'ready')
  const deadline = Date.now() + 5_000
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, phones.length) }, async () => {
    while (next < phones.length) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('Current calling rules could not be checked. Refresh the contact before dialing.')
      const phone = phones[next++]
      const decision = await evaluateOutboundDialerCall({
        phone: phone.number,
        source: 'web_heir_dialer',
        surface: 'prospecting',
        leadId: subject.leadId,
        prospectId: phone.prospect_id || subject.prospectId,
        prospectPhoneId: phone.prospect_phone_id,
      }, { timeoutMs: Math.max(1, Math.min(2_500, Math.floor(remaining / 2))) })
      if (!decision.allowed) {
        if (decision.reason === 'policy_unavailable') throw new Error('Current calling rules could not be checked. Refresh the contact before dialing.')
        phone.status = 'suppressed'
        phone.suppression_reason = decision.reason
      }
    }
  }))
  return result.map((group) => ({
    ...group,
    unattempted_count: group.phones.filter((phone) => phone.status === 'ready' && !phone.attempted).length,
  }))
}
