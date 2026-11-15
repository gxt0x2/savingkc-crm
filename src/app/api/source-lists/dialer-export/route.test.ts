import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  sandbox: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/auth/oauth-review-sandbox-session', () => ({ resolveOauthReviewSandboxLeadId: mocks.sandbox }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }))

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
        excluded_counts: { prospect_dnc: 3, disconnected: 1, person_fanout: 60 },
        excluded_phones: [
          { reason: 'prospect_dnc', phone_masked: '******0101' },
          { reason: 'disconnected', phone_masked: '+18165555774' },
        ],
      },
      error: null,
    })
  })

  it('records a scrub batch and returns only the phones from that batch', async () => {
    const logged: string[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((message) => {
      logged.push(String(message))
    })
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export?listType=tax&county=jackson&state=MO'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-source-list-export-batch')).toBe(batchId)
    const csv = await response.text()
    expect(csv).toContain('+18165550101')
    expect(csv).toContain(batchId)
    expect(csv).not.toContain('8165550199')
    expect(mocks.rpc.mock.calls[0][0]).toBe('sync_phone_line_check_config_v1')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_block_enabled: false })
    expect(mocks.rpc.mock.calls[1][0]).toBe('record_source_list_export_batch_v1')
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({
      p_list_type: 'tax_delinquent',
      p_county: 'jackson',
      p_state: 'MO',
    })
    expect(response.headers.get('x-dialer-export-excluded-counts')).toBe('{"prospect_dnc":3,"disconnected":1,"person_fanout":60}')
    expect(logged.join('\n')).toContain('******0101')
    expect(logged.join('\n')).not.toContain('8165555774')
    expect(logged.join('\n')).not.toContain('+18165555774')
    spy.mockRestore()
  })

  it('refuses a multi-line export while that mode is suspended', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export?lineMode=2'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'multi_line_suspended' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns the saved lane filters without writing an export', async () => {
    const sets = [
      { priority: 1, name: 'Deceased', lane_key: 'deceased', single_line: true, daily_cap_first_3_days: 30, daily_cap: 75 },
      { priority: 2, name: 'Tax 3+', lane_key: 'tax_delinquent', single_line: false, daily_cap_first_3_days: 30, daily_cap: 75 },
      { priority: 3, name: 'Probate', lane_key: 'probate_estate', single_line: false, daily_cap_first_3_days: 30, daily_cap: 75 },
      { priority: 4, name: 'Inherited', lane_key: 'probate_no_property', single_line: false, daily_cap_first_3_days: 30, daily_cap: 75 },
      { priority: 5, name: 'Code Violation', lane_key: 'code_violation', single_line: false, daily_cap_first_3_days: 30, daily_cap: 75 },
      { priority: 6, name: 'Expired (single-line, disclosure)', lane_key: 'mls_expired', single_line: true, daily_cap_first_3_days: 30, daily_cap: 75 },
    ]
    const order = vi.fn().mockResolvedValue({ data: sets, error: null })
    const select = vi.fn().mockReturnValue({ order })
    mocks.from.mockReturnValue({ select })
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export?sets=1'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sets })
    expect(order).toHaveBeenCalledWith('priority')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses an anonymous export', async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export'))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
