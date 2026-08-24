import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import { GET } from './route'

describe('GET /api/leads/[id]/ppc-signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'lead-1', source: 'ppc-landing', station: 'appointment_set' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'ppc_tracking_events') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [{
                    traffic_source: 'google_ads',
                    campaign: 'Search 2026',
                    gclid: 'canonical-click',
                    payload: { attribution: { utm_medium: 'cpc' } },
                  }],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'ppc_conversion_outbox') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })
  })

  it('reads paid-source evidence from canonical tracking without Manifest', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/leads/lead-1/ppc-signals'), {
      params: Promise.resolve({ id: 'lead-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      leadId: 'lead-1',
      isPaidLead: true,
      sourceLabel: 'Google Ads',
      campaign: 'Search 2026',
      identifierType: 'gclid',
      hasIdentifier: true,
    })
    expect(mocks.from).not.toHaveBeenCalledWith('manifests')
  })

  it('fails closed when canonical attribution cannot be read', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'lead-1', source: 'ppc-landing', station: 'new' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'ppc_tracking_events') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: null, error: { message: 'tracking unavailable' } }),
              }),
            }),
          }),
        }
      }
      if (table === 'ppc_conversion_outbox') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await GET(new Request('https://crm.savingkc.com/api/leads/lead-1/ppc-signals'), {
      params: Promise.resolve({ id: 'lead-1' }),
    })
    expect(response.status).toBe(500)
  })
})
