import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { sendPushToAgentNames } from '@/lib/push-notifications'
import { safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'
import { sendTeamLeadAlert } from './lead-team-alerts'

vi.mock('@/lib/lead-alert-routing', () => ({
  getLeadAlertRecipients: vi.fn(),
}))

vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgentNames: vi.fn(),
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
    process.env.TWILIO_PHONE_NUMBER = '+18163077835'
  })

  it('sends SMS to scheduled recipients and logs delivery status', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
      { name: 'Casey', phone: '+18160000002', schedule: 'weekday_business_hours' },
    ])
    vi.mocked(sendPushToAgentNames).mockResolvedValue(2)
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
  })
})
