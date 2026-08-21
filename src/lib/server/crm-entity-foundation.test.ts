import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}))

import { isEntityFoundationUnavailable, readLeadEntityContext, safeReadLeadEntityContext } from './crm-entity-foundation'

describe('CRM entity foundation server reads', () => {
  beforeEach(() => mocks.maybeSingle.mockReset())

  it('recognizes missing-table and stale-schema-cache errors', () => {
    expect(isEntityFoundationUnavailable({ code: '42P01' })).toBe(true)
    expect(isEntityFoundationUnavailable({ code: 'PGRST205' })).toBe(true)
    expect(isEntityFoundationUnavailable({ message: "Could not find crm_lead_entity_links in the schema cache" })).toBe(true)
    expect(isEntityFoundationUnavailable({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('returns an explicit migration-pending context when the projection table is absent', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: '42P01', message: 'missing relation' } })
    await expect(readLeadEntityContext('lead-1')).resolves.toMatchObject({
      available: false,
      linked: false,
      degraded: true,
    })
  })

  it('contains unexpected dual-read failures instead of breaking the compatibility lead view', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: '500', message: 'temporary database outage' } })
    await expect(safeReadLeadEntityContext('lead-1')).resolves.toMatchObject({
      available: false,
      degraded: true,
    })
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })
})
