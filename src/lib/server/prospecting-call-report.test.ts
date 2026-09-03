import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))

import { getProspectingCallReport, parseProspectingCallReport } from './prospecting-call-report'

const campaignId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const attemptId = '33333333-3333-4333-8333-333333333333'

function reportPayload() {
  return {
    campaign: { id: campaignId, name: 'Jackson · Tax 3+ · Sep 2', status: 'completed', currentRunNumber: 2 },
    runNumber: 2,
    metrics: { sessions: 1, agents: 1, attempts: 3, providerConnected: 2, reached: 1, resultsSaved: 2, failed: 1, uniqueNumbers: 3, durationSeconds: 88, skips: 0 },
    outcomes: { spoke_with_owner: 1, no_answer: 1 },
    runs: [{ runNumber: 2, sessions: 1, resultsSaved: 2, reached: 1, skips: 0, startedAt: '2026-09-02T18:00:00.000Z', lastActivityAt: '2026-09-02T19:00:00.000Z' }],
    agents: [{ email: 'casey@savingkc.com', name: 'Casey', sessions: 1, resultsSaved: 2, reached: 1, skips: 0 }],
    sessions: [{ id: sessionId, campaignId, campaignName: 'Jackson · Tax 3+ · Sep 2', runNumber: 2, agentName: 'Casey', agentEmail: 'casey@savingkc.com', status: 'completed', queueSize: 3, resultsSaved: 2, reached: 1, skips: 0, outcomes: { spoke_with_owner: 1, no_answer: 1 }, startedAt: '2026-09-02T18:00:00.000Z', endedAt: '2026-09-02T19:00:00.000Z', updatedAt: '2026-09-02T19:00:00.000Z' }],
    attempts: {
      items: [{ id: attemptId, sessionId, campaignId, campaignName: 'Jackson · Tax 3+ · Sep 2', runNumber: 2, agentName: 'Casey', agentEmail: 'casey@savingkc.com', sellerName: 'Helen Seller', propertyAddress: '123 Main St, Kansas City MO 64131', phone: '+18165550123', callerId: '+18163100845', status: 'dispositioned', disposition: 'spoke_with_owner', reached: true, durationSeconds: 88, createdAt: '2026-09-02T18:01:00.000Z', startedAt: '2026-09-02T18:01:01.000Z', connectedAt: '2026-09-02T18:01:05.000Z', endedAt: '2026-09-02T18:02:29.000Z' }],
      pageInfo: { limit: 50, offset: 50, total: 3, hasMore: false },
    },
  }
}

describe('Prospecting call report', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses campaign, agent, session, phone, and outcome reporting', () => {
    const report = parseProspectingCallReport(reportPayload())

    expect(report.campaign).toMatchObject({ id: campaignId, currentRunNumber: 2 })
    expect(report.metrics).toMatchObject({ attempts: 3, reached: 1, uniqueNumbers: 3 })
    expect(report.outcomes).toEqual({ spoke_with_owner: 1, no_answer: 1 })
    expect(report.agents[0]).toMatchObject({ name: 'Casey', resultsSaved: 2 })
    expect(report.attempts.items[0]).toMatchObject({ phone: '+18165550123', disposition: 'spoke_with_owner' })
  })

  it('requests one bounded report page for the authenticated actor', async () => {
    mocks.rpc.mockResolvedValue({ data: reportPayload(), error: null })

    const report = await getProspectingCallReport(
      { email: 'casey@savingkc.com', name: 'Casey' },
      campaignId,
      { runNumber: 2, page: 2, limit: 50 },
    )

    expect(mocks.rpc).toHaveBeenCalledWith('prospecting_campaign_call_report_v1', {
      p_campaign_id: campaignId,
      p_actor_email: 'casey@savingkc.com',
      p_run_number: 2,
      p_from: null,
      p_to_exclusive: null,
      p_limit: 50,
      p_offset: 50,
    })
    expect(report.attempts.pageInfo.offset).toBe(50)
  })

  it('requests all campaigns within exact Central date boundaries', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...reportPayload(), campaign: { id: null, name: 'All campaigns', status: 'all', currentRunNumber: null }, runNumber: null }, error: null })

    await getProspectingCallReport({ email: 'casey@savingkc.com', name: 'Casey' }, null, { from: '2026-09-03', to: '2026-09-03' })

    expect(mocks.rpc).toHaveBeenCalledWith('prospecting_campaign_call_report_v1', expect.objectContaining({
      p_campaign_id: null,
      p_run_number: null,
      p_from: '2026-09-03T05:00:00.000Z',
      p_to_exclusive: '2026-09-04T05:00:00.000Z',
    }))
  })

  it('fails closed on malformed report payloads', () => {
    expect(() => parseProspectingCallReport({ campaign: {}, metrics: {}, attempts: {} })).toThrow(/report data is unavailable/i)
  })

  it('rejects invalid filters before database work', async () => {
    await expect(getProspectingCallReport(
      { email: 'casey@savingkc.com', name: 'Casey' },
      'not-a-campaign',
      { page: 0 },
    )).rejects.toMatchObject({ code: 'invalid_campaign_id', status: 400 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
