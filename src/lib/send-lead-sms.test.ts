import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  isOptedOut: vi.fn(),
  isDuplicateSms: vi.fn(),
  logSmsSend: vi.fn(),
  safeSendSMS: vi.fn(),
  checkAutoAdvance: vi.fn(),
  onCommunicationEvent: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}))
vi.mock('@/lib/sms-opt-out', () => ({ isOptedOut: mocks.isOptedOut }))
vi.mock('@/lib/sms-dedup', () => ({
  isDuplicateSms: mocks.isDuplicateSms,
  logSmsSend: mocks.logSmsSend,
}))
vi.mock('@/lib/safe-communications', () => ({ safeSendSMS: mocks.safeSendSMS }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.checkAutoAdvance }))
vi.mock('@/lib/manifest-sync', () => ({ onCommunicationEvent: mocks.onCommunicationEvent }))

import { resolveSmsFromNumber, sendLeadSms } from './send-lead-sms'

describe('conversation SMS sender resolution and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    mocks.isOptedOut.mockResolvedValue(false)
    mocks.isDuplicateSms.mockResolvedValue(false)
    mocks.logSmsSend.mockResolvedValue(undefined)
    mocks.safeSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM123',
      from: '+18166088552',
      requestedFrom: '+18166088552',
      senderMismatch: false,
    })
    mocks.checkAutoAdvance.mockResolvedValue(undefined)
    mocks.onCommunicationEvent.mockResolvedValue(undefined)
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ insert: mocks.insert })
  })

  it('uses an explicit sender override without querying conversation history', async () => {
    const from = await resolveSmsFromNumber('lead-1', '+19135550123', '+18166088552')

    expect(from).toBe('+18166088552')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when a protected tracking number is used as a conversation override', async () => {
    await expect(resolveSmsFromNumber('lead-1', '+19135550123', '+18166088808'))
      .rejects.toThrow('not approved for conversations')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('prefers the approved company line from the bounded indexed timeline', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          activity_type: 'sms',
          created_at: '2026-06-25T15:00:00.000Z',
          metadata: { direction: 'received', from: '+19135550123', to: '+18166088559' },
        },
        {
          activity_type: 'sms',
          created_at: '2026-06-25T14:00:00.000Z',
          metadata: { direction: 'outbound', from: '+18163077835', to: '+19135550123' },
        },
      ],
      error: null,
    })

    const from = await resolveSmsFromNumber('lead-1', '(913) 555-0123')

    expect(from).toBe('+18166088559')
    expect(mocks.rpc).toHaveBeenCalledWith('conversation_timeline_page_v1', {
      target_thread_key: 'lead:lead-1',
      page_limit: 101,
      before_created_at: null,
      before_activity_id: null,
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('uses the indexed phone thread for an unmatched caller', async () => {
    await resolveSmsFromNumber(null, '(913) 555-0123')

    expect(mocks.rpc).toHaveBeenCalledWith('conversation_timeline_page_v1', expect.objectContaining({
      target_thread_key: 'phone:+19135550123',
      page_limit: 101,
    }))
  })

  it('reports delivered-but-not-persisted and warns against resending', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'Database unavailable' } })

    const result = await sendLeadSms({
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      fromPhone: '+18166088552',
      agent: 'Casey',
    })

    expect(result).toMatchObject({
      status: 'sent',
      sid: 'SM123',
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: expect.stringContaining('Do not resend'),
    })
    expect(mocks.logSmsSend).toHaveBeenCalled()
  })

  it('also reports delivered-but-not-persisted when the database request rejects', async () => {
    mocks.insert.mockRejectedValue(new Error('network unavailable'))

    const result = await sendLeadSms({
      phone: '+19135550123',
      body: 'Hello',
      fromPhone: '+18166088552',
    })

    expect(result).toMatchObject({
      status: 'sent',
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: expect.stringContaining('Do not resend'),
    })
  })
})
