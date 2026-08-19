import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { handleOptIn, handleOptOut, isOptedOut } from './sms-opt-out'

describe('SMS suppression persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.upsert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mocks.maybeSingle }),
        }),
      }),
      upsert: mocks.upsert,
    })
  })

  it('normalizes the number and treats no active row as callable', async () => {
    await expect(isOptedOut('(913) 555-0123')).resolves.toBe(false)
    expect(mocks.from).toHaveBeenCalledWith('sms_opt_outs')
  })

  it('fails closed when suppression status cannot be verified', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })

    await expect(isOptedOut('+19135550123')).rejects.toThrow('could not be verified')
  })

  it('does not silently acknowledge a failed opt-out write', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'write failed' } })

    await expect(handleOptOut('+19135550123', 'stop')).rejects.toThrow('could not be saved')
  })

  it('does not silently acknowledge a failed opt-in write', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'write failed' } })

    await expect(handleOptIn('+19135550123')).rejects.toThrow('could not be saved')
  })
})
