import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export function excludeCompletedDialerPhones(
  queue: HeirDialerQueueItem[],
  completedPhoneIds: string[],
  completedPhones: string[],
): HeirDialerQueueItem[] {
  const completedPhoneIdSet = new Set(completedPhoneIds)
  const completedPhoneSet = new Set(completedPhones.flatMap((phone) => {
    const normalized = normalizePhoneToE164(phone)
    return normalized ? [normalized] : []
  }))

  return queue.filter((item) => {
    if (item.prospect_phone_id) return !completedPhoneIdSet.has(item.prospect_phone_id)
    const normalized = normalizePhoneToE164(item.phone)
    return !normalized || !completedPhoneSet.has(normalized)
  })
}
