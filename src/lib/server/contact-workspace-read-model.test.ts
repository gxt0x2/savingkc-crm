import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))

import { readContactWorkspaceActivitySummaries } from './contact-workspace-read-model'

describe('contact workspace read model', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    rpc.mockReset()
  })

  it('deduplicates ids and returns one summary map', async () => {
    rpc.mockResolvedValue({
      data: [{ lead_id: 'lead-1', attention_state: 'needs_reply' }],
      error: null,
    })

    const summaries = await readContactWorkspaceActivitySummaries(
      ['lead-1', 'lead-1'],
      { rpc },
    )

    expect(rpc).toHaveBeenCalledWith('contact_workspace_activity_summary_v1', {
      target_lead_ids: ['lead-1'],
    })
    expect(summaries.get('lead-1')?.attention_state).toBe('needs_reply')
  })

  it('keeps each database request capped at 250 leads', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const leadIds = Array.from({ length: 501 }, (_, index) => `lead-${index}`)

    await readContactWorkspaceActivitySummaries(leadIds, { rpc })

    expect(rpc).toHaveBeenCalledTimes(3)
    expect(rpc.mock.calls.map((call) => call[1].target_lead_ids.length)).toEqual([250, 250, 1])
  })

  it('fails closed when the summary cannot be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function missing' } })

    await expect(readContactWorkspaceActivitySummaries(['lead-1'], { rpc }))
      .rejects.toThrow('Contact activity summary could not be loaded')
  })
})
