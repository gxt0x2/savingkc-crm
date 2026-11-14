import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ingest: vi.fn() }))
vi.mock('@/lib/server/foreclosure-intake', () => ({ ingestForeclosureBatch: mocks.ingest }))

import { POST } from './route'

describe('foreclosure intake route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('FORECLOSURE_INTAKE_SECRET', '')
  })

  it('fails closed when the intake secret is not configured', async () => {
    const response = await POST(new Request('http://localhost/api/prospecting/foreclosure/intake', {
      method: 'POST',
      headers: { authorization: 'Bearer anything' },
      body: JSON.stringify({ rows: [] }),
    }))
    expect(response.status).toBe(503)
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong bearer', async () => {
    vi.stubEnv('FORECLOSURE_INTAKE_SECRET', 'intake-secret-value')
    for (const authorization of [null, 'Bearer wrong-secret']) {
      const headers = authorization ? { authorization } : undefined
      const response = await POST(new Request('http://localhost/api/prospecting/foreclosure/intake', {
        method: 'POST',
        headers,
        body: JSON.stringify({ rows: [] }),
      }))
      expect(response.status).toBe(401)
    }
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it('accepts the configured bearer and does not read a hardcoded secret', async () => {
    vi.stubEnv('FORECLOSURE_INTAKE_SECRET', 'intake-secret-value')
    mocks.ingest.mockResolvedValue({ accepted: 1, appended: 0, rejected: [] })
    const response = await POST(new Request('http://localhost/api/prospecting/foreclosure/intake', {
      method: 'POST',
      headers: { authorization: 'Bearer intake-secret-value', 'content-type': 'application/json' },
      body: JSON.stringify({
        pull_date: '2026-11-14',
        rows: [{
          state: 'MO',
          county: 'Jackson',
          source: 'Case.net',
          case_number_or_notice_id: 'SAMPLE-1',
          filing_or_notice_date: '2026-11-01',
          sale_date: '',
          property_address: '100 Sample Lane',
          owner_or_defendant: 'Sample Homeowner',
          plaintiff_or_trustee_firm: 'Sample Trustee',
          stage: 'Lis Pendens',
          source_url: 'https://example.com/sample',
        }],
      }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.ingest).toHaveBeenCalledOnce()
  })
})
