import { describe, expect, it, vi } from 'vitest'
import { readDialerQueuePage } from './dialer-queue-read-model'

describe('readDialerQueuePage', () => {
  it('calls the bounded projection and normalizes its response', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        leads: [{ id: 'lead-1' }],
        queue_context: [{ leadId: 'lead-1', callAttemptCount: 2 }],
        prospects: [{ lead_id: 'lead-1', is_deceased: true }],
        queue_metrics: { callsToday: 3, uniqueLeadsToday: 2 },
        total_count: 52,
      }],
      error: null,
    })

    const page = await readDialerQueuePage({
      limit: 5000,
      leadIds: ['lead-1'],
      referenceTime: '2026-08-22T15:00:00.000Z',
    }, { rpc })

    expect(rpc).toHaveBeenCalledWith('dialer_queue_page_v1', {
      target_limit: 1000,
      target_lead_ids: ['lead-1'],
      reference_time: '2026-08-22T15:00:00.000Z',
    })
    expect(page).toEqual({
      leads: [{ id: 'lead-1' }],
      queueContext: [{ leadId: 'lead-1', callAttemptCount: 2 }],
      prospects: [{ lead_id: 'lead-1', is_deceased: true }],
      queueMetrics: { callsToday: 3, uniqueLeadsToday: 2 },
      totalCount: 52,
    })
  })

  it('fails closed with a generic error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'private database detail' } })
    await expect(readDialerQueuePage({ limit: 100 }, { rpc })).rejects.toThrow('Dialer queue could not be loaded')
  })
})
