import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  readLead360: vi.fn(),
  readEntity: vi.fn(),
  listWorkItems: vi.fn(),
  startGeneration: vi.fn(),
  completeGeneration: vi.fn(),
  failGeneration: vi.fn(),
  replayGeneration: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  Output: { object: vi.fn((value) => value) },
}))
vi.mock('@/lib/assistant/queries', () => ({ readAssistantLead360: mocks.readLead360 }))
vi.mock('@/lib/server/crm-entity-foundation', () => ({ readLeadEntityContext: mocks.readEntity }))
vi.mock('@/lib/server/work-items', () => ({ listWorkItems: mocks.listWorkItems }))
vi.mock('@/lib/ai/generation-store', () => ({
  startAssistantArtifactGeneration: mocks.startGeneration,
  completeAssistantGeneration: mocks.completeGeneration,
  failAssistantGeneration: mocks.failGeneration,
  replayAssistantGeneration: mocks.replayGeneration,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from, rpc: mocks.rpc }) }))

import {
  generateCanonicalLeadBriefing,
  getCanonicalLeadBriefingState,
  queueCanonicalLeadBriefing,
} from './canonical-lead-briefing'

const leadId = '11111111-1111-4111-8111-111111111111'
const claimToken = '22222222-2222-4222-8222-222222222222'

function query(result: { data: unknown; error: unknown }) {
  type Builder = PromiseLike<typeof result> & Record<'select' | 'eq' | 'order' | 'limit' | 'maybeSingle', ReturnType<typeof vi.fn>>
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  } as Builder
  for (const method of [builder.select, builder.eq, builder.order, builder.limit]) method.mockReturnValue(builder)
  builder.maybeSingle.mockResolvedValue(result)
  return builder
}

describe('canonical lead briefing service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readLead360.mockResolvedValue({
      record: {
        lead: { id: leadId, full_name: 'Pat Seller', updated_at: '2026-08-23T10:00:00.000Z' },
        activities: [{ id: 'activity-1', activity_type: 'note', description: 'Call Friday', created_at: '2026-08-23T11:00:00.000Z' }],
        appointments: [], dispositionDeals: [], buyerOffers: [], transactionCoordination: [],
      },
    })
    mocks.readEntity.mockResolvedValue({ linked: false, degraded: true })
    mocks.listWorkItems.mockResolvedValue([])
    mocks.from.mockImplementation((table: string) => {
      if (table === 'lead_co_owners') return query({ data: [], error: null })
      throw new Error(`unexpected table:${table}`)
    })
    mocks.startGeneration.mockResolvedValue({ created: true, generationId: 'generation-1', threadId: 'thread-1' })
    mocks.generateText.mockResolvedValue({
      output: {
        situation: 'Pat Seller owns the recorded property and requested a Friday call.',
        motivation: 'The timing request is explicit, but price motivation is not recorded.',
        strategy: 'Use the Friday call to confirm timeline, decision makers, and price expectations.',
        confidence: 'medium',
        evidenceIds: [`lead:${leadId}`, 'activity:activity-1'],
      },
      finalStep: { model: { provider: 'openai', modelId: 'gpt-5.6-luna' } },
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280, inputTokenDetails: { cacheReadTokens: 0 } },
      finishReason: 'stop',
    })
    mocks.completeGeneration.mockResolvedValue({})
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'save_current_briefing_v1') return Promise.resolve({ data: { id: 'briefing-1' }, error: null })
      if (name === 'queue_crm_briefing_v1') return Promise.resolve({ data: 3, error: null })
      throw new Error(`unexpected rpc:${name}`)
    })
  })

  it('generates from bounded canonical evidence, records provenance, and atomically saves', async () => {
    const result = await generateCanonicalLeadBriefing({
      claim: { leadId, revision: 3, claimToken, reason: 'activity_changed', requestedBy: 'system:activity_trigger' },
    })

    expect(result.generationId).toBe('generation-1')
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5.6-luna' }))
    expect(mocks.completeGeneration).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'generation-1',
      metadata: expect.objectContaining({ feature: 'canonical_lead_briefing', sourceRevision: 3 }),
    }))
    expect(mocks.rpc).toHaveBeenCalledWith('save_current_briefing_v1', expect.objectContaining({
      p_lead_id: leadId,
      p_generation_id: 'generation-1',
      p_source_revision: 3,
      p_prompt_version: 'canonical-lead-briefing-v1',
    }))
    expect(mocks.from).not.toHaveBeenCalledWith('manifests')
  })

  it('queues a refresh through the durable revision service', async () => {
    await expect(queueCanonicalLeadBriefing({
      leadId,
      reason: 'manual_refresh',
      requestedBy: 'casey@savingkc.com',
      delaySeconds: 0,
    })).resolves.toBe(3)
    expect(mocks.rpc).toHaveBeenCalledWith('queue_crm_briefing_v1', expect.objectContaining({ p_lead_id: leadId }))
  })

  it('reports a newer pending revision as stale', async () => {
    const briefing = query({ data: {
      situation: 'Situation', motivation: 'Motivation', strategy: 'Strategy',
      generated_at: '2026-08-23T10:00:00.000Z', generated_by: 'worker', prompt_version: 'canonical-lead-briefing-v1',
      generation_id: 'generation-1', source_snapshot_at: '2026-08-23T09:00:00.000Z', source_revision: 2,
    }, error: null })
    const job = query({ data: { status: 'pending', revision: 3, available_at: '2026-08-23T11:00:00.000Z', attempts: 0 }, error: null })
    mocks.from.mockImplementation((table: string) => ({ briefings: briefing, crm_briefing_jobs: job })[table as 'briefings' | 'crm_briefing_jobs'])

    await expect(getCanonicalLeadBriefingState(leadId)).resolves.toMatchObject({ freshness: 'stale', refresh: { revision: 3 } })
  })
})
