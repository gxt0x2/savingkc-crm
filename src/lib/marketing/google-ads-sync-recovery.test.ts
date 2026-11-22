import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))

import { chicagoDayStartIso, resolveCatchUpWindow } from './google-ads-reporting-sync'

describe('Google Ads catch-up window', () => {
  it('walks forward from the last synced day, 30 days at a time', () => {
    expect(resolveCatchUpWindow({ lastStoredDate: '2026-06-13', since: '2026-11-15', until: '2026-11-21' }))
      .toEqual({ since: '2026-06-14', until: '2026-07-13', catchUp: true })
  })

  it('stops at the normal window end', () => {
    expect(resolveCatchUpWindow({ lastStoredDate: '2026-11-01', since: '2026-11-15', until: '2026-11-21' }))
      .toEqual({ since: '2026-11-02', until: '2026-11-21', catchUp: true })
  })

  it('leaves the normal window alone when current or unknown', () => {
    const normal = { since: '2026-11-15', until: '2026-11-21', catchUp: false }
    expect(resolveCatchUpWindow({ lastStoredDate: '2026-11-20', since: '2026-11-15', until: '2026-11-21' })).toEqual(normal)
    expect(resolveCatchUpWindow({ lastStoredDate: null, since: '2026-11-15', until: '2026-11-21' })).toEqual(normal)
  })
})

describe('Chicago day start', () => {
  it('is midnight Central in UTC (standard and daylight time)', () => {
    expect(chicagoDayStartIso(new Date('2026-11-21T20:00:00Z'))).toBe('2026-11-21T06:00:00.000Z')
    expect(chicagoDayStartIso(new Date('2026-07-04T20:00:00Z'))).toBe('2026-07-04T05:00:00.000Z')
    expect(chicagoDayStartIso(new Date('2026-11-22T03:00:00Z'))).toBe('2026-11-21T06:00:00.000Z')
  })
})
