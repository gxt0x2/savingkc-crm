import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, maybeSingle, query } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const query = {
    select: vi.fn(),
    or: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle,
  }
  const from = vi.fn(() => query)
  return { from, maybeSingle, query }
})

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from },
}))

import { callSidActivityOrFilter, resolveLeadIdFromCallActivity } from './recording-lead-resolution'

describe('recording lead resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.select.mockReturnValue(query)
    query.or.mockReturnValue(query)
    query.not.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.limit.mockReturnValue(query)
  })

  it('matches every supported call SID metadata shape', () => {
    expect(callSidActivityOrFilter('CA123')).toBe(
      'metadata->>callSid.eq.CA123,metadata->>CallSid.eq.CA123,metadata->>call_sid.eq.CA123,metadata->>parentCallSid.eq.CA123,metadata->>parent_call_sid.eq.CA123',
    )
    expect(callSidActivityOrFilter('CA123),lead_id.not.is.null')).toBeNull()
  })

  it('returns the newest lead already associated with the recorded call', async () => {
    maybeSingle.mockResolvedValue({ data: { lead_id: 'lead-123' }, error: null })

    await expect(resolveLeadIdFromCallActivity('CA123')).resolves.toBe('lead-123')

    expect(from).toHaveBeenCalledWith('lead_activities')
    expect(query.or).toHaveBeenCalledWith(callSidActivityOrFilter('CA123'))
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('fails closed when no activity mapping is available', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'lookup failed' } })
    await expect(resolveLeadIdFromCallActivity('CA123')).resolves.toBeNull()
  })
})
