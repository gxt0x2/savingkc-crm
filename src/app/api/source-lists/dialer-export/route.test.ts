import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  sandbox: vi.fn(),
  from: vi.fn(),
  filters: [] as Array<[string, string]>,
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/auth/oauth-review-sandbox-session', () => ({ resolveOauthReviewSandboxLeadId: mocks.sandbox }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      mocks.from(table)
      const builder = {
        select() { return builder },
        order() { return builder },
        eq(column: string, value: string) {
          mocks.filters.push([column, value])
          return builder
        },
        range() {
          return Promise.resolve({
            data: [{
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
              source_list_row_id: 'row-1',
              source_list_id: 'list-1',
              phone_origin: 'source_row',
            }],
            error: null,
          })
        },
      }
      return builder
    },
  }),
}))

import { GET } from './route'

describe('GET /api/source-lists/dialer-export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.filters = []
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.sandbox.mockResolvedValue(null)
  })

  it('reads only the scrubbed export view', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export?listType=tax&county=jackson&state=MO'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('cache-control')).toContain('no-store')
    const csv = await response.text()
    expect(csv).toContain('+18165550101')
    expect(csv).not.toContain('8165550199')
    expect(mocks.from).toHaveBeenCalledWith('source_list_dialer_export')
    expect(mocks.from).not.toHaveBeenCalledWith('source_list_rows')
    expect(mocks.from).not.toHaveBeenCalledWith('mojo_call_queue')
    expect(mocks.filters).toContainEqual(['list_type', 'tax_delinquent'])
    expect(mocks.filters).toContainEqual(['county', 'jackson'])
  })

  it('refuses an anonymous export', async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export'))).status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
