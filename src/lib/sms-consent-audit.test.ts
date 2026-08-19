import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  handleOptOut: vi.fn(),
  handleOptIn: vi.fn(),
  isOptedOut: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/google-ads-phone', () => ({ phoneLookupVariants: (phone: string) => [phone] }))
vi.mock('@/lib/sms-opt-out', () => ({
  handleOptOut: mocks.handleOptOut,
  handleOptIn: mocks.handleOptIn,
  isOptedOut: mocks.isOptedOut,
  isStopKeyword: (value: string) => value.trim().toUpperCase() === 'STOP',
  isStartKeyword: (value: string) => value.trim().toUpperCase() === 'START',
}))

import { processInboundSmsConsent } from './sms-consent-audit'

const input = {
  from: '+19135550123',
  to: '+18163077835',
  keyword: 'STOP',
  messageSid: 'SM-consent-event',
  source: 'twilio_sms_webhook' as const,
}

describe('SMS consent persistence and audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handleOptOut.mockResolvedValue(undefined)
    mocks.handleOptIn.mockResolvedValue(undefined)
    mocks.isOptedOut.mockResolvedValue(false)
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockImplementation((table: string) => table === 'leads'
      ? {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id: '00000000-0000-4000-8000-000000000001' }, error: null }),
              }),
            }),
          }),
        }
      : { insert: mocks.insert })
  })

  it('persists STOP before returning a confirmation and writes an idempotent timeline fact', async () => {
    await expect(processInboundSmsConsent(input)).resolves.toContain('unsubscribed')

    expect(mocks.handleOptOut).toHaveBeenCalledWith(input.from, 'STOP')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      lead_id: '00000000-0000-4000-8000-000000000001',
      activity_type: 'status_change',
      metadata: expect.objectContaining({
        event: 'sms_opt_out',
        hub_action: 'mark_read',
        message_sid: input.messageSid,
      }),
    }))
  })

  it('throws when STOP persistence fails so Twilio can retry', async () => {
    mocks.handleOptOut.mockRejectedValue(new Error('suppression unavailable'))

    await expect(processInboundSmsConsent(input)).rejects.toThrow('suppression unavailable')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps a successful STOP authoritative when only its timeline audit fails', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'audit unavailable' } })

    await expect(processInboundSmsConsent(input)).resolves.toContain('unsubscribed')
  })

  it('persists START and returns an opt-in confirmation', async () => {
    await expect(processInboundSmsConsent({ ...input, keyword: 'START' })).resolves.toContain('re-subscribed')
    expect(mocks.handleOptIn).toHaveBeenCalledWith(input.from)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
