import { describe, expect, it } from 'vitest'

import { ANDON_PROCESS_CASCADES, extractAndonRecordContext } from './andon'

describe('Andon routing model', () => {
  it('uses the approved department-specific process cascades', () => {
    expect(ANDON_PROCESS_CASCADES).toEqual({
      Marketing: ['Skip Tracing Sync', 'PPC Landing Page', 'List Import Error'],
      Acquisitions: ['AI Text Bot Sequence', 'Cold Dialer Lag', 'Callback Automation'],
      Dispositions: ['Cash Buyer Email Blast', 'VIP List Tagging', 'SMS Blast Blocked'],
      'Transaction Coordination': ['Title Company Hand-off', 'EMD Tracking', 'Inspection Period Bug'],
    })
  })

  it('captures a canonical lead URL from a lead route or lead query context', () => {
    expect(extractAndonRecordContext('https://crm.savingkc.com/leads/lead-123?tab=overview')).toEqual({
      recordId: 'lead-123',
      recordType: 'lead',
      recordUrl: 'https://crm.savingkc.com/leads/lead-123?tab=overview',
    })
    expect(extractAndonRecordContext('https://crm.savingkc.com/reports/andon?lead_id=lead-123')).toEqual({
      recordId: 'lead-123',
      recordType: 'lead',
      recordUrl: 'https://crm.savingkc.com/leads/lead-123',
    })
  })
})
