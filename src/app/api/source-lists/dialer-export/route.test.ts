import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  sandbox: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/auth/oauth-review-sandbox-session', () => ({ resolveOauthReviewSandboxLeadId: mocks.sandbox }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { GET } from './route'

const batchId = '22222222-2222-4222-8222-222222222222'

describe('GET /api/source-lists/dialer-export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.sandbox.mockResolvedValue(null)
    mocks.rpc.mockResolvedValue({
      data: {
        export_batch_id: batchId,
        phone_count: 1,
        rows: [{
          list_type: 'tax_delinquent',
          county: 'jackson',
          state: 'MO',
          violation_kind: null,
          parcel_id: 'P1',
          case_id: null,
          address: '10 Oak',
          owner_names: 'Ada',
          amount_owed: '5',
          phone_e164: '+18165550101',
          property_id: null,
          prospect_id: null,
          row_status: 'ready',
          pull_date: '2026-11-14',
          source_file_name: 'jackson.csv',
          source_list_row_id: '11111111-1111-4111-8111-111111111111',
          source_list_id: '33333333-3333-4333-8333-333333333333',
          phone_origin: 'source_row',
        }],
      },
      error: null,
    })
  })

  it('records a scrub batch and returns only the phones from that batch', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export?listType=tax&county=jackson&state=MO'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-source-list-export-batch')).toBe(batchId)
    const csv = await response.text()
    expect(csv).toContain('+18165550101')
    expect(csv).toContain(batchId)
    expect(csv).not.toContain('8165550199')
    expect(mocks.rpc.mock.calls[0][0]).toBe('record_source_list_export_batch_v1')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_list_type: 'tax_delinquent',
      p_county: 'jackson',
      p_state: 'MO',
    })
  })

  it('refuses an anonymous export', async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export'))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
