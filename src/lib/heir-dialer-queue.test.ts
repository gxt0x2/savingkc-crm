/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { dispatchHeirQueue, type HeirDialerQueueItem } from './heir-dialer-queue'
import { CRM_DIALER_QUEUE_EVENT, PROSPECTING_DIALER_QUEUE_EVENT } from '@/lib/telephony/dialer-events'

const queue: HeirDialerQueueItem[] = [{
  prospect_phone_id: 'phone-1',
  prospectId: 'prospect-1',
  phone: '+18165550100',
  heirName: 'Helen Seller',
  relation: 'daughter',
  leadId: 'lead-1',
  campaignMemberId: 'member-1',
  propertyAddress: '123 Main St',
  deceasedOwnerName: 'Mary Seller',
}]

describe('heir dialer queue events', () => {
  it('publishes CRM and Prospecting queues on different channels', () => {
    const crmListener = vi.fn()
    const prospectingListener = vi.fn()
    window.addEventListener(CRM_DIALER_QUEUE_EVENT, crmListener)
    window.addEventListener(PROSPECTING_DIALER_QUEUE_EVENT, prospectingListener)

    dispatchHeirQueue(queue, null, null, undefined, null, 'crm')
    expect(crmListener).toHaveBeenCalledOnce()
    expect(prospectingListener).not.toHaveBeenCalled()

    dispatchHeirQueue(queue, null, null, undefined, 'session-1', 'prospecting')
    expect(crmListener).toHaveBeenCalledOnce()
    expect(prospectingListener).toHaveBeenCalledOnce()

    window.removeEventListener(CRM_DIALER_QUEUE_EVENT, crmListener)
    window.removeEventListener(PROSPECTING_DIALER_QUEUE_EVENT, prospectingListener)
  })
})
