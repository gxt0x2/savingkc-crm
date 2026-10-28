import { describe, expect, it } from 'vitest'
import { assistantResultCount, buildAssistantSourceCatalog, gmailSourceCatalogEntry, readAssistantMarketingSummary, readAssistantWebsiteFunnel, sanitizeAssistantMetadata } from '@/lib/assistant/queries'
import { CALLER_ID_VERIFICATION_ACTOR } from '@/lib/telephony/caller-id-verification'

function funnelDb(leads: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      const data = table === 'leads' ? leads : []
      const builder = {
        select: () => builder,
        gte: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data, error: null }),
      }
      return builder
    },
  }
}

describe('assistant lead funnel counts', () => {
  const leads = [
    { id: 'seller-call', full_name: 'Maria Seller', source: 'inbound_call', form_status: null, station: 'new', classification: null, dead_by: null, opportunity_score: null, created_at: '2026-10-27T14:00:00.000Z', updated_at: '2026-10-27T14:00:00.000Z' },
    { id: 'form', full_name: 'Website Seller', source: 'website_form', form_status: 'submitted', station: 'new', classification: null, dead_by: null, opportunity_score: null, created_at: '2026-10-27T14:05:00.000Z', updated_at: '2026-10-27T14:05:00.000Z' },
    { id: 'robocall', full_name: 'New caller · (603) 792-8544', source: 'inbound_call', form_status: null, station: 'dead', classification: 'dead', dead_by: CALLER_ID_VERIFICATION_ACTOR, opportunity_score: 0, created_at: '2026-10-27T13:25:00.000Z', updated_at: '2026-10-27T13:26:00.000Z' },
  ]

  it('counts a seller inbound call and leaves out a caller ID verification lead', async () => {
    const db = funnelDb(leads)
    const funnel = await readAssistantWebsiteFunnel(db as never, 7)
    const marketing = await readAssistantMarketingSummary(db as never, 7)

    expect(funnel.leads.total).toBe(2)
    expect(funnel.leads.bySource).toEqual(expect.arrayContaining([
      { label: 'inbound_call', count: 1 },
      { label: 'website_form', count: 1 },
    ]))
    expect(funnel.leads.recent.map((lead) => lead.id)).toEqual(['seller-call', 'form'])
    expect(marketing.leads.total).toBe(2)
    expect(marketing.leads.bySource).toEqual(funnel.leads.bySource)
  })
})

describe('assistant query safety helpers', () => {
  it('removes credential-shaped metadata while preserving operational evidence', () => {
    expect(sanitizeAssistantMetadata({
      transcript: 'Seller asked for Friday.',
      api_key: 'do-not-return',
      nested: { authorization: 'secret', outcome: 'appointment_set' },
    })).toEqual({
      transcript: 'Seller asked for Friday.',
      nested: { outcome: 'appointment_set' },
    })
  })

  it('removes recording URLs and bounds oversized metadata strings', () => {
    const sanitized = sanitizeAssistantMetadata({
      recordingUrl: 'https://recordings.example/private',
      transcript: 'x'.repeat(12_100),
    }) as Record<string, unknown>

    expect(sanitized.recordingUrl).toBeUndefined()
    expect(String(sanitized.transcript)).toContain('[content truncated]')
    expect(String(sanitized.transcript).length).toBeLessThan(12_100)
  })

  it('reports connected and explicitly missing sources', () => {
    const catalog = buildAssistantSourceCatalog('2026-08-19T12:00:00.000Z')
    expect(catalog.readOnly).toBe(true)
    expect(catalog.sources.find((item) => item.id === 'crm')?.connected).toBe(true)
    expect(catalog.sources.find((item) => item.id === 'google-analytics')?.connected).toBe(false)
  })

  it('maps Gmail health so a dead grant is visible without opening Settings', () => {
    const gmail = gmailSourceCatalogEntry({
      oauthConfigured: true,
      status: 'down',
      lastSyncAt: '2026-09-18T13:15:00.000Z',
      errorCode: 'invalid_grant',
      accounts: [{
        userEmail: 'ernest@savingkc.com',
        status: 'reauthorization_required',
        lastSyncAt: '2026-09-18T13:15:00.000Z',
        errorCode: 'invalid_grant',
        staleSync: true,
        missingScopes: [],
      }],
    })

    expect(gmail).toMatchObject({
      id: 'gmail',
      connected: false,
      oauthConfigured: true,
      status: 'down',
      lastSyncAt: '2026-09-18T13:15:00.000Z',
      errorCode: 'invalid_grant',
    })
  })

  it('counts common result shapes for metadata-only audit rows', () => {
    expect(assistantResultCount({ records: [1, 2] })).toBe(2)
    expect(assistantResultCount({ record: { id: 'lead' } })).toBe(1)
    expect(assistantResultCount({ generatedAt: 'now' })).toBeNull()
  })
})
