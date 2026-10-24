import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { isMobilePushConfigured, sendMobilePushToAgentNames } from '@/lib/mobile-push'
import { isWebPushConfigured, sendPushToAgentNames } from '@/lib/push-notifications'
import { safeSendSMS } from '@/lib/safe-communications'
import { sendCrmTransactionalEmail } from '@/lib/server/transactional-email'
import { supabase } from '@/lib/supabase-lazy'

const afterMocks = vi.hoisted(() => ({
  afterRequest: vi.fn((work: () => unknown) => {
    void work()
  }),
}))

vi.mock('@/lib/after-request', () => ({
  afterRequest: (work: () => unknown) => afterMocks.afterRequest(work),
}))

import { isInternalNewLeadAlert, sendTeamLeadAlert } from './lead-team-alerts'

vi.mock('@/lib/lead-alert-routing', () => ({
  getLeadAlertRecipients: vi.fn(),
}))

vi.mock('@/lib/mobile-push', () => ({
  sendMobilePushToAgentNames: vi.fn(),
  isMobilePushConfigured: vi.fn(() => true),
}))

vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgentNames: vi.fn(),
  isWebPushConfigured: vi.fn(() => true),
}))

vi.mock('@/lib/server/transactional-email', () => ({
  sendCrmTransactionalEmail: vi.fn(),
}))

vi.mock('@/lib/safe-communications', () => ({
  safeSendSMS: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

describe('sendTeamLeadAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterMocks.afterRequest.mockImplementation((work: () => unknown) => {
      void work()
    })
    process.env.TWILIO_PHONE_NUMBER = '+18163077835'
    vi.mocked(isMobilePushConfigured).mockReturnValue(true)
    vi.mocked(isWebPushConfigured).mockReturnValue(true)
    vi.mocked(sendCrmTransactionalEmail).mockResolvedValue({
      success: true,
      status: 'sent',
      id: 'email-1',
      error: null,
    })
  })

  it('keeps reply alerts out of the new-lead channel', () => {
    expect(isInternalNewLeadAlert('website_lead_alert')).toBe(true)
    expect(isInternalNewLeadAlert('ppc_lead_alert')).toBe(true)
    expect(isInternalNewLeadAlert('lead_reply_alert')).toBe(false)
    expect(isInternalNewLeadAlert('yes_reply_alert')).toBe(false)
    expect(isInternalNewLeadAlert('known_missed_call_alert')).toBe(false)
  })

  it('sends SMS to scheduled recipients and logs delivery status', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
      { name: 'Casey', phone: '+18160000002', schedule: 'weekday_business_hours' },
    ])
    vi.mocked(sendPushToAgentNames).mockResolvedValue(2)
    vi.mocked(sendMobilePushToAgentNames).mockResolvedValue(2)
    vi.mocked(safeSendSMS).mockImplementation(async ({ body, from, to }) => ({
      success: true,
      sid: `sid-${to.slice(-4)}`,
      body,
      from,
      to,
    }))
    const insert = vi.fn(async () => ({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const result = await sendTeamLeadAlert({
      leadId: 'lead-123',
      smsBody: 'New lead',
      trigger: 'unit_test_alert',
      source: 'website_form',
      push: {
        title: 'New lead',
        body: 'Lead body',
        url: '/leads/lead-123',
        tag: 'lead-123',
      },
    })

    expect(result.recipients.map((recipient) => recipient.name)).toEqual(['Ernest', 'Casey'])
    expect(safeSendSMS).toHaveBeenCalledTimes(2)
    expect(sendPushToAgentNames).toHaveBeenCalledWith(['Ernest', 'Casey'], {
      title: 'New lead',
      body: 'Lead body',
      url: '/leads/lead-123',
      tag: 'lead-123',
    })
    expect(sendMobilePushToAgentNames).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-123',
      activity_type: 'sms',
      metadata: expect.objectContaining({
        to_agents: ['Ernest', 'Casey'],
        alert_schedule: [
          { name: 'Ernest', schedule: '24_7' },
          { name: 'Casey', schedule: 'weekday_business_hours' },
        ],
      }),
    }))
  })

  it('does not send SMS or push when a company line has no scheduled recipients', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([])
    const insert = vi.fn(async () => ({ error: null }))
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const result = await sendTeamLeadAlert({
      leadId: 'lead-123',
      smsBody: 'After-hours alert',
      trigger: 'unit_test_alert',
      calledNumber: '+18167277667',
      push: {
        title: 'After hours',
        body: 'Do not send',
        url: '/leads/lead-123',
        tag: 'after-hours',
      },
    })

    expect(result.recipients).toEqual([])
    expect(safeSendSMS).not.toHaveBeenCalled()
    expect(sendPushToAgentNames).not.toHaveBeenCalled()
    expect(sendMobilePushToAgentNames).not.toHaveBeenCalled()
  })

  it('sends Expo push for a missed call using the CallSid as eventId', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
    ])
    vi.mocked(sendMobilePushToAgentNames).mockResolvedValue(1)
    vi.mocked(safeSendSMS).mockResolvedValue({ success: true, sid: 'sid-0001', body: 'Missed', from: '+18163077835', to: '+18160000001' })
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn(async () => ({ error: null })) } as never)

    await sendTeamLeadAlert({
      leadId: 'lead-123',
      smsBody: 'Missed call',
      trigger: 'known_missed_call_alert',
      source: 'inbound_call',
      push: {
        title: 'Missed Call - Hot Lead',
        body: 'Pat called and got no answer.',
        url: '/leads/lead-123',
        tag: 'missed-call',
      },
      metadata: { callSid: 'CA123', from: '+19137179716' },
    })

    expect(sendPushToAgentNames).toHaveBeenCalledWith(['Ernest'], expect.objectContaining({ tag: 'missed-call' }))
    expect(sendMobilePushToAgentNames).toHaveBeenCalledWith(['Ernest'], {
      title: 'Missed Call - Hot Lead',
      body: 'Pat called and got no answer.',
      data: {
        href: '/conversation/lead-123',
        kind: 'missed_call',
        leadId: 'lead-123',
        eventId: 'call_CA123',
      },
    })
  })

  it('sends Expo push for voicemail using the RecordingSid as eventId', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
      { name: 'Casey', phone: '+18160000002', schedule: 'weekday_business_hours' },
    ])
    vi.mocked(sendMobilePushToAgentNames).mockResolvedValue(2)
    vi.mocked(safeSendSMS).mockResolvedValue({ success: true, sid: 'sid-0001', body: 'VM', from: '+18163077835', to: '+18160000001' })
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn(async () => ({ error: null })) } as never)

    await sendTeamLeadAlert({
      leadId: 'lead-vm',
      smsBody: 'New voicemail',
      trigger: 'voicemail_recording_alert',
      source: 'inbound_voicemail',
      push: {
        title: 'New Voicemail',
        body: 'Voicemail from (913) 717-9716',
        url: '/leads/lead-vm',
        tag: 'voicemail',
      },
      metadata: { recordingSid: 'RE999', callSid: 'CA999' },
    })

    expect(sendMobilePushToAgentNames).toHaveBeenCalledWith(['Ernest', 'Casey'], {
      title: 'New Voicemail',
      body: 'Voicemail from (913) 717-9716',
      data: {
        href: '/conversation/lead-vm',
        kind: 'voicemail',
        leadId: 'lead-vm',
        eventId: 'vm_RE999',
      },
    })
  })

  it('schedules Web and Expo push with after() so the caller can return first', async () => {
    const queued: Array<() => unknown> = []
    afterMocks.afterRequest.mockImplementation((work: () => unknown) => {
      queued.push(work)
    })
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
    ])
    vi.mocked(sendMobilePushToAgentNames).mockResolvedValue(1)
    vi.mocked(safeSendSMS).mockResolvedValue({ success: true, sid: 'sid-0001', body: 'Missed', from: '+18163077835', to: '+18160000001' })
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn(async () => ({ error: null })) } as never)

    await sendTeamLeadAlert({
      leadId: 'lead-123',
      smsBody: 'Missed call',
      trigger: 'known_missed_call_alert',
      source: 'inbound_call',
      push: {
        title: 'Missed Call - Hot Lead',
        body: 'Pat called and got no answer.',
        url: '/leads/lead-123',
        tag: 'missed-call',
      },
      metadata: { callSid: 'CA123', from: '+19137179716' },
    })

    expect(sendPushToAgentNames).not.toHaveBeenCalled()
    expect(sendMobilePushToAgentNames).not.toHaveBeenCalled()
    expect(queued).toHaveLength(1)
    await queued[0]()
    expect(sendPushToAgentNames).toHaveBeenCalledWith(['Ernest'], expect.objectContaining({ tag: 'missed-call' }))
    expect(sendMobilePushToAgentNames).toHaveBeenCalledWith(['Ernest'], expect.objectContaining({
      data: expect.objectContaining({ kind: 'missed_call', eventId: 'call_CA123' }),
    }))
    expect(sendCrmTransactionalEmail).not.toHaveBeenCalled()
  })

  it('skips SMS for a website lead and records push and email delivery', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
      { name: 'Casey', phone: '+18160000002', schedule: 'weekday_business_hours' },
    ])
    vi.mocked(sendPushToAgentNames).mockResolvedValue(1)
    vi.mocked(sendMobilePushToAgentNames).mockResolvedValue(1)
    const insert = vi.fn(async (row: { metadata: { delivery_status: Array<Record<string, unknown>> } }) => ({ error: null, row }))
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const result = await sendTeamLeadAlert({
      leadId: 'lead-123',
      smsBody: 'New Website lead: Pat at 1 Main. Phone: (816) 555-1212. https://crm.savingkc.com/leads/lead-123',
      trigger: 'website_lead_alert',
      source: 'contact',
      push: {
        title: 'Website lead',
        body: 'Pat at 1 Main',
        url: '/leads/lead-123',
        tag: 'website-lead-lead-123',
      },
    })

    expect(result.smsResults).toEqual([])
    expect(safeSendSMS).not.toHaveBeenCalled()
    expect(sendMobilePushToAgentNames).toHaveBeenCalledWith(['Ernest'], {
      title: 'Website lead',
      body: 'Pat at 1 Main',
      data: {
        href: '/leads/lead-123',
        kind: 'new_lead',
        leadId: 'lead-123',
        eventId: 'lead_lead-123',
      },
    })
    expect(sendMobilePushToAgentNames).toHaveBeenCalledWith(['Casey'], expect.objectContaining({
      data: expect.objectContaining({ kind: 'new_lead' }),
    }))
    expect(sendCrmTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ernest@savingkc.com',
      subject: 'Website lead',
      text: expect.stringContaining('New Website lead'),
    }))
    expect(sendCrmTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'casey@savingkc.com',
    }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        trigger: 'website_lead_alert',
        sms_status: 'skipped',
        sms_skip_reason: 'automated_sms_disabled',
      }),
    }))
    const metadata = insert.mock.calls[0][0].metadata as { delivery_status: Array<Record<string, unknown>> }
    expect(metadata.delivery_status).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'mobile_push', target: 'Ernest', success: true, status: 'sent' }),
      expect.objectContaining({ channel: 'web_push', target: 'Ernest', success: true, status: 'sent' }),
      expect.objectContaining({ channel: 'email', target: 'Ernest', to: 'ernest@savingkc.com', success: true, status: 'sent', sid: 'email-1' }),
      expect.objectContaining({ channel: 'email', target: 'Casey', to: 'casey@savingkc.com', success: true }),
    ]))
    expect(metadata.delivery_status.some((row) => row.channel === 'sms')).toBe(false)
    expect(JSON.stringify(metadata.delivery_status)).not.toContain('Automated SMS is disabled')
  })

  it('records mobile push as not configured without attempting SMS', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
    ])
    vi.mocked(isMobilePushConfigured).mockReturnValue(false)
    vi.mocked(isWebPushConfigured).mockReturnValue(false)
    vi.mocked(sendCrmTransactionalEmail).mockResolvedValue({
      success: false,
      status: 'not_configured',
      id: null,
      error: 'Transactional email sender is not configured',
    })
    const insert = vi.fn(async (row: { metadata: { delivery_status: Array<Record<string, unknown>> } }) => ({ error: null, row }))
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await sendTeamLeadAlert({
      leadId: 'lead-123',
      smsBody: 'New PPC lead',
      trigger: 'ppc_lead_alert',
      push: {
        title: 'New PPC lead',
        body: 'Pat',
        url: '/leads/lead-123',
        tag: 'ppc-lead-lead-123',
      },
    })

    expect(safeSendSMS).not.toHaveBeenCalled()
    expect(sendMobilePushToAgentNames).not.toHaveBeenCalled()
    expect(sendPushToAgentNames).not.toHaveBeenCalled()
    const metadata = insert.mock.calls[0][0].metadata as { delivery_status: Array<Record<string, unknown>> }
    expect(metadata.delivery_status).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'mobile_push', status: 'not_configured', success: false }),
      expect.objectContaining({ channel: 'web_push', status: 'not_configured', success: false }),
      expect.objectContaining({ channel: 'email', status: 'not_configured', success: false }),
    ]))
  })
})
