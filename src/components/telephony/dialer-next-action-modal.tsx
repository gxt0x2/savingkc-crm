'use client'

import { NewTaskModal } from '@/components/modals/new-task-modal'
import type { HeirQueueItem } from './telephony-bar-types'
import type { SearchResult } from './telephony-bar-support'

export type DialerNextActionSubject = {
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
  dialerSessionId: string | null
  name: string
  propertyAddress: string | null
}

export function buildDialerNextActionSubject(
  queueItem: HeirQueueItem | null,
  selectedLead: SearchResult | null,
  dialerSessionId: string | null,
): DialerNextActionSubject | null {
  if (queueItem) return {
    leadId: queueItem.leadId,
    prospectId: queueItem.prospectId,
    campaignMemberId: queueItem.campaignMemberId,
    dialerSessionId,
    name: queueItem.heirName,
    propertyAddress: queueItem.propertyAddress,
  }
  if (!selectedLead) return null
  return {
    leadId: selectedLead.id,
    prospectId: null,
    campaignMemberId: null,
    dialerSessionId: null,
    name: selectedLead.full_name,
    propertyAddress: selectedLead.property_address,
  }
}

export function DialerNextActionModal({
  onClose,
  subject,
}: {
  onClose: () => void
  subject: DialerNextActionSubject
}) {
  return <NewTaskModal
    leadId={subject.leadId || undefined}
    prospectId={subject.prospectId || undefined}
    campaignMemberId={subject.campaignMemberId || undefined}
    dialerSessionId={subject.dialerSessionId || undefined}
    leadName={subject.name || undefined}
    initialTitle={`Follow up with ${subject.name || 'seller'}`}
    primaryNextAction={Boolean(subject.leadId)}
    onClose={onClose}
    onCreated={() => {
      onClose()
      window.dispatchEvent(new CustomEvent('crm:task-created', {
        detail: {
          leadId: subject.leadId,
          prospectId: subject.prospectId,
          campaignMemberId: subject.campaignMemberId,
        },
      }))
    }}
  />
}
