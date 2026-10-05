import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ full_name: string | null }>,
  error: null as { message: string } | null,
  throwOnQuery: false,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => ({
          order: () => ({
            limit: async () => {
              if (mocks.throwOnQuery) throw new Error('database unavailable')
              return { data: mocks.rows, error: mocks.error }
            },
          }),
        }),
      }),
    }),
  },
}))

import { lookupInboundCallerName } from './inbound-caller-name'

describe('inbound caller name', () => {
  beforeEach(() => {
    mocks.rows = []
    mocks.error = null
    mocks.throwOnQuery = false
  })

  it('returns the newest displayable CRM name', async () => {
    mocks.rows = [
      { full_name: 'New caller · (816) 555-0199' },
      { full_name: 'Jane Seller' },
    ]

    await expect(lookupInboundCallerName('+18165550199')).resolves.toBe('Jane Seller')
  })

  it('returns an empty name when every match is a synthetic intake label', async () => {
    mocks.rows = [{ full_name: 'Inbound Seller' }, { full_name: 'Unknown caller' }]

    await expect(lookupInboundCallerName('8165550199')).resolves.toBe('')
  })

  it('returns an empty name when the lookup fails', async () => {
    mocks.error = { message: 'permission denied' }
    await expect(lookupInboundCallerName('+18165550199')).resolves.toBe('')

    mocks.error = null
    mocks.throwOnQuery = true
    await expect(lookupInboundCallerName('+18165550199')).resolves.toBe('')
  })

  it('does not query when the caller number is not a US phone', async () => {
    mocks.throwOnQuery = true
    await expect(lookupInboundCallerName('Anonymous')).resolves.toBe('')
  })
})
