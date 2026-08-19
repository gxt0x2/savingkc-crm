import { describe, expect, it } from 'vitest'
import { assistantResultCount, readAssistantSourceCatalog, sanitizeAssistantMetadata } from '@/lib/assistant/queries'

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
    const catalog = readAssistantSourceCatalog('2026-08-19T12:00:00.000Z')
    expect(catalog.readOnly).toBe(true)
    expect(catalog.sources.find((item) => item.id === 'crm')?.connected).toBe(true)
    expect(catalog.sources.find((item) => item.id === 'google-analytics')?.connected).toBe(false)
  })

  it('counts common result shapes for metadata-only audit rows', () => {
    expect(assistantResultCount({ records: [1, 2] })).toBe(2)
    expect(assistantResultCount({ record: { id: 'lead' } })).toBe(1)
    expect(assistantResultCount({ generatedAt: 'now' })).toBeNull()
  })
})
