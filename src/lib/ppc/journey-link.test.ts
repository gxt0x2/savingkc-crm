import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))

import { cleanJourneyId, linkJourneyToLead, visitorIdFromBody } from './journey-link'

describe('journey link', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts browser ids and rejects anything else', () => {
    expect(cleanJourneyId('3f1c2a9e-6b0d-4c3e-9a51-2f0e8d7c6b5a')).toBe('3f1c2a9e-6b0d-4c3e-9a51-2f0e8d7c6b5a')
    expect(cleanJourneyId("x' or 1=1 --")).toBeNull()
    expect(cleanJourneyId('short')).toBeNull()
    expect(cleanJourneyId(42)).toBeNull()
  })

  it('reads visitor_id from the body, touch, then attribution', () => {
    expect(visitorIdFromBody({ visitor_id: 'top-level-visitor' })).toBe('top-level-visitor')
    expect(visitorIdFromBody({ touch: { visitor_id: 'touch-visitor-1' } })).toBe('touch-visitor-1')
    expect(visitorIdFromBody({ attribution: { visitor_id: 'attr-visitor-1' } })).toBe('attr-visitor-1')
    expect(visitorIdFromBody({})).toBeNull()
  })

  it('calls the stitching function with cleaned ids and returns the linked count', async () => {
    mocks.rpc.mockResolvedValue({ data: 7, error: null })
    await expect(linkJourneyToLead({ leadId: 'lead-1', sessionId: 'session-abc-123', visitorId: 'bad id!' })).resolves.toBe(7)
    expect(mocks.rpc).toHaveBeenCalledWith('link_journey_to_lead_v1', {
      p_lead_id: 'lead-1', p_session_id: 'session-abc-123', p_visitor_id: null,
    })
  })

  it('skips the call without ids and never throws', async () => {
    await expect(linkJourneyToLead({ leadId: 'lead-1' })).resolves.toBe(0)
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockRejectedValue(new Error('down'))
    await expect(linkJourneyToLead({ leadId: 'lead-1', visitorId: 'visitor-abc-1' })).resolves.toBe(0)
  })
})
