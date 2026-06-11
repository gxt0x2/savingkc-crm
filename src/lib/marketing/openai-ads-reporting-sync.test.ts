import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runOpenAIAdsReportingSync } from './openai-ads-reporting-sync'

const mocks = vi.hoisted(() => ({
  supabase: null as unknown,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => mocks.supabase,
}))

function supabaseMock() {
  const upserts: Array<{ table: string; rows: unknown[]; onConflict?: string }> = []
  const inserts: Array<{ table: string; row: unknown }> = []
  const updates: Array<{ table: string; row: unknown }> = []

  const client = {
    from: vi.fn((table: string) => ({
      insert: (row: unknown) => ({
        select: () => ({
          single: async () => {
            inserts.push({ table, row })
            return { data: { id: 'run_123' }, error: null }
          },
        }),
      }),
      update: (row: unknown) => ({
        eq: async () => {
          updates.push({ table, row })
          return { error: null }
        },
      }),
      upsert: async (rows: unknown[], options?: { onConflict?: string }) => {
        upserts.push({ table, rows, onConflict: options?.onConflict })
        return { error: null }
      },
    })),
  }

  return { client, upserts, inserts, updates }
}

describe('runOpenAIAdsReportingSync', () => {
  beforeEach(() => {
    delete process.env.OPENAI_ADS_API_KEY
    delete process.env.OPENAI_ADS_API_BASE
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    delete process.env.OPENAI_ADS_API_KEY
    delete process.env.OPENAI_ADS_API_BASE
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('is a configured=false no-op when the advertiser reporting key is missing', async () => {
    const db = supabaseMock()
    mocks.supabase = db.client
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runOpenAIAdsReportingSync({
      since: '2026-06-11',
      until: '2026-06-11',
      write: true,
    })

    expect(result).toMatchObject({
      ok: true,
      configured: false,
      dryRun: false,
      campaignRows: 0,
      runId: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.client.from).not.toHaveBeenCalled()
  })

  it('imports campaign daily insights into the OpenAI Ads read model', async () => {
    process.env.OPENAI_ADS_API_KEY = 'test-reporting-key'
    process.env.OPENAI_ADS_API_BASE = 'https://api.ads.openai.com/v1'
    const db = supabaseMock()
    mocks.supabase = db.client

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'act_123',
        name: 'Saving KC',
        currency_code: 'USD',
        timezone: 'America/Chicago',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: [{
          readable_time: '2026-06-11',
          campaign_id: 'cmpn_123',
          campaign_name: 'Search 2026',
          impressions: 52,
          clicks: 2,
          spend: 7.5,
          conversions: 1,
        }],
        has_more: false,
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runOpenAIAdsReportingSync({
      since: '2026-06-11',
      until: '2026-06-11',
      write: true,
    })

    expect(result).toMatchObject({
      ok: true,
      configured: true,
      dryRun: false,
      accountId: 'act_123',
      campaignRows: 1,
      runId: 'run_123',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const insightsUrl = String(fetchMock.mock.calls[1]?.[0])
    expect(insightsUrl).toContain('/ad_account/insights')
    expect(insightsUrl).toContain('aggregation_level=campaign')
    expect(insightsUrl).toContain('time_granularity=daily')

    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0]).toMatchObject({
      table: 'openai_ads_campaign_daily',
      onConflict: 'date,account_id,campaign_id',
    })
    expect(db.upserts[0].rows[0]).toMatchObject({
      date: '2026-06-11',
      account_id: 'act_123',
      account_name: 'Saving KC',
      campaign_id: 'cmpn_123',
      campaign_name: 'Search 2026',
      impressions: 52,
      clicks: 2,
      cost_micros: 7_500_000,
      conversions: 1,
      all_conversions: 1,
      currency_code: 'USD',
      timezone: 'America/Chicago',
    })
    expect(db.updates.at(-1)?.row).toMatchObject({
      status: 'success',
      campaign_rows: 1,
      metadata: {
        account_id: 'act_123',
        account_name: 'Saving KC',
        currency_code: 'USD',
      },
    })
  })
})
