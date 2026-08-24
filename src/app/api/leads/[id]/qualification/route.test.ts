import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

import { GET, PATCH } from './route'

function params() {
  return { params: Promise.resolve({ id: 'lead-1' }) }
}

function readQuery() {
  return {
    select() { return this },
    async eq() { return { data: mocks.rows, error: null } },
  }
}

describe('lead qualification route', () => {
  beforeEach(() => {
    mocks.actor.mockReset().mockResolvedValue({ email: 'casey@example.com', name: 'Casey' })
    mocks.rows.splice(0)
    mocks.from.mockReset().mockImplementation(() => readQuery())
    mocks.rpc.mockReset().mockResolvedValue({ data: { complete: true }, error: null })
  })

  it('rejects unauthenticated reads before touching CRM data', async () => {
    mocks.actor.mockResolvedValue(null)

    const response = await GET(new NextRequest('http://localhost/api/leads/lead-1/qualification'), params())

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns legacy evidence as review-only, never complete', async () => {
    mocks.rows.push({
      pillar: 'TIMELINE',
      evidence: 'Within 30 days',
      status: 'needs_review',
      source_type: 'legacy_manifest',
      verified_by_name: null,
      verified_at: null,
    })

    const response = await GET(new NextRequest('http://localhost/api/leads/lead-1/qualification'), params())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ complete: false, verifiedCount: 0 })
    expect(payload.pillars[0]).toMatchObject({ pillar: 'TIMELINE', status: 'needs_review', sourceType: 'legacy_manifest' })
  })

  it('stamps the verified actor through the atomic save RPC', async () => {
    mocks.rows.push(
      ...['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'].map((pillar) => ({
        pillar,
        evidence: `${pillar} evidence`,
        status: 'verified',
        source_type: 'operator',
        verified_by_name: 'Casey',
        verified_at: '2026-08-24T04:00:00.000Z',
      })),
    )
    const request = new NextRequest('http://localhost/api/leads/lead-1/qualification', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pillars: {
          TIMELINE: ' Within 30 days ',
          CONDITION: 'Fair condition',
          MOTIVATION: 'Inherited property',
          PRICE: '$125,000',
        },
      }),
    })

    const response = await PATCH(request, params())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ complete: true, verifiedCount: 4 })
    expect(mocks.rpc).toHaveBeenCalledWith('save_crm_lead_qualification_v1', {
      p_lead_id: 'lead-1',
      p_pillars: {
        TIMELINE: 'Within 30 days',
        CONDITION: 'Fair condition',
        MOTIVATION: 'Inherited property',
        PRICE: '$125,000',
      },
      p_actor_email: 'casey@example.com',
      p_actor_name: 'Casey',
    })
  })
})
