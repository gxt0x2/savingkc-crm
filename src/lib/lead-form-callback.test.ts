import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { getTwilioClient } from '@/lib/safe-communications'
import {
  buildFormLeadCallbackIntro,
  firstNameFromFullName,
  startPpcFormLeadAgentCallback,
  streetFromAddress,
} from './lead-form-callback'

vi.mock('@/lib/lead-alert-routing', () => ({
  getLeadAlertRecipients: vi.fn(),
}))

vi.mock('@/lib/safe-communications', () => ({
  getTwilioClient: vi.fn(),
}))

describe('lead-form-callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the first name in the agent intro', () => {
    expect(firstNameFromFullName('Rob Seller')).toBe('Rob')
    expect(firstNameFromFullName('')).toBe('A seller')
  })

  it('uses the street portion of the address', () => {
    expect(streetFromAddress('123 Main St, Kansas City, MO 64131')).toBe('123 Main St')
  })

  it('builds the form-specific callback intro without saying Google Ads', () => {
    expect(buildFormLeadCallbackIntro({
      fullName: 'Rob Seller',
      address: '123 Main St, Kansas City, MO 64131',
      city: 'Kansas City',
    })).toBe('Rob is looking to sell their place on 123 Main St in Kansas City. Calling them now.')
  })

  it('starts form callback calls for every eligible lead-alert recipient', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
      { name: 'Casey', phone: '+18160000002', schedule: 'weekday_business_hours' },
    ])

    const create = vi.fn(async ({ to }: { to: string; url: string }) => ({ sid: `sid-${to.slice(-4)}` }))
    vi.mocked(getTwilioClient).mockReturnValue({
      calls: { create },
    } as unknown as ReturnType<typeof getTwilioClient>)

    const result = await startPpcFormLeadAgentCallback({
      leadId: 'lead-123',
      leadPhone: '+18165551212',
      callerId: '+18166088808',
      fullName: 'Rob Seller',
      address: '123 Main St, Kansas City, MO',
      city: 'Kansas City',
      trigger: 'ppc_form_submit',
    })

    expect(result.started).toBe(true)
    expect(result.to).toBe('+18160000001')
    expect(result.calls).toHaveLength(2)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: '+18160000001',
      from: '+18166088808',
      method: 'POST',
      timeout: 20,
    }))
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: '+18160000002',
      from: '+18166088808',
      method: 'POST',
      timeout: 20,
    }))

    const ernestUrl = new URL(create.mock.calls[0][0].url)
    expect(ernestUrl.searchParams.get('callerId')).toBe('+18166088808')
    const caseyUrl = new URL(create.mock.calls[1][0].url)
    expect(ernestUrl.searchParams.get('batchId')).toBeTruthy()
    expect(caseyUrl.searchParams.get('batchId')).toBe(ernestUrl.searchParams.get('batchId'))
    expect(ernestUrl.searchParams.get('agentName')).toBe('Ernest')
    expect(caseyUrl.searchParams.get('agentName')).toBe('Casey')
  })

  it('trims a trailing newline from the configured caller ID without changing the number', async () => {
    vi.mocked(getLeadAlertRecipients).mockReturnValue([
      { name: 'Ernest', phone: '+18162262552\n', schedule: '24_7' },
    ])
    const create = vi.fn(async ({ to, url }: { to: string; from: string; url: string }) => ({
      sid: `CA-${to.slice(-4)}`,
      echoed: url.length > 0,
    }))
    vi.mocked(getTwilioClient).mockReturnValue({
      calls: { create },
    } as unknown as ReturnType<typeof getTwilioClient>)

    const result = await startPpcFormLeadAgentCallback({
      leadId: 'lead-123',
      leadPhone: '+18165551212\n',
      callerId: '+18163077835\n',
      fullName: 'Pat Seller',
      trigger: 'website_form_submit',
    })

    expect(result.started).toBe(true)
    expect(result.to).toBe('+18162262552')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      to: '+18162262552',
      from: '+18163077835',
    }))
    const url = new URL(create.mock.calls[0][0].url)
    expect(url.searchParams.get('callerId')).toBe('+18163077835')
    expect(url.searchParams.get('leadPhone')).toBe('+18165551212')
    expect(url.searchParams.get('agentPhone')).toBe('+18162262552')
    expect(url.searchParams.get('callerId')).not.toMatch(/\s/)
  })
})
