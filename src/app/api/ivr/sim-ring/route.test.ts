import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { POST } from './route'

vi.mock('@/lib/agent-routing', () => ({
  getAgentRouting: vi.fn(() => ({
    primary: { name: 'Ernest', phone: '+18160000001', companyNumber: '+18166088588' },
    secondary: { name: 'Casey', phone: '+18160000002', companyNumber: '+18167277667' },
  })),
}))

vi.mock('@/lib/lead-alert-routing', () => ({
  getLeadAlertRecipients: vi.fn(),
}))

describe('/api/ivr/sim-ring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rings only scheduled lead-alert recipients', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
    ])

    const response = await POST(new Request('https://crm.savingkc.com/api/ivr/sim-ring?from=%2B18165551212&leadId=lead-123&calledNumber=%2B18166088808&type=seller', {
      method: 'POST',
    }))
    const twiml = await response.text()

    expect(twiml).toContain('+18160000001')
    expect(twiml).not.toContain('+18160000002')
    expect(twiml).toContain('agent=Ernest')
  })

  it('rings Casey too during her scheduled window', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
      { name: 'Casey', phone: '+18160000002', schedule: 'weekday_business_hours' },
    ])

    const response = await POST(new Request('https://crm.savingkc.com/api/ivr/sim-ring?from=%2B18165551212&leadId=lead-123&calledNumber=%2B18166088808&type=seller', {
      method: 'POST',
    }))
    const twiml = await response.text()

    expect(twiml).toContain('+18160000001')
    expect(twiml).toContain('+18160000002')
    expect(twiml).toContain('agent=Casey')
  })
})
