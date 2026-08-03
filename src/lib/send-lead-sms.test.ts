import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { resolveSmsFromNumber } from './send-lead-sms'

function leadActivitiesQuery(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(async () => ({ data: rows, error: null }))
  return chain
}

describe('resolveSmsFromNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses an explicit sender override without querying conversation history', async () => {
    const from = await resolveSmsFromNumber('lead-1', '+19135550123', '+18166088552')

    expect(from).toBe('+18166088552')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('fails closed when a protected tracking number is used as a conversation override', async () => {
    await expect(resolveSmsFromNumber('lead-1', '+19135550123', '+18166088808'))
      .rejects.toThrow('not approved for conversations')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('prefers the company line from the latest inbound SMS for that contact', async () => {
    const rows = [
      {
        activity_type: 'sms',
        created_at: '2026-06-25T15:00:00.000Z',
        metadata: {
          direction: 'received',
          from: '+19135550123',
          to: '+18166088559',
        },
      },
      {
        activity_type: 'sms',
        created_at: '2026-06-25T14:00:00.000Z',
        metadata: {
          direction: 'outbound',
          from: '+18163077835',
          to: '+19135550123',
        },
      },
    ]
    mocks.from.mockReturnValue(leadActivitiesQuery(rows))

    const from = await resolveSmsFromNumber('lead-1', '(913) 555-0123')

    expect(from).toBe('+18166088559')
  })
})
