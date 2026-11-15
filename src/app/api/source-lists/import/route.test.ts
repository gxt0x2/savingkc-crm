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

import { POST } from './route'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/source-lists/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/source-lists/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.sandbox.mockResolvedValue(null)
    mocks.rpc.mockResolvedValue({
      data: { source_list_id: 'list-1', inserted: 1, updated: 0, row_count: 1 },
      error: null,
    })
  })

  it('accepts the cron secret without a session and rejects a wrong secret', async () => {
    process.env.CRON_SECRET = 'box-secret'
    mocks.actor.mockResolvedValue(null)
    const denied = await POST(new NextRequest('https://crm.savingkc.com/api/source-lists/import', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(denied.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()

    const accepted = await POST(new NextRequest('https://crm.savingkc.com/api/source-lists/import', {
      method: 'POST',
      headers: {
        authorization: 'Bearer box-secret',
        'content-type': 'application/json',
        'x-imported-by': 'box-script',
      },
      body: JSON.stringify({
        listType: 'code_violation',
        violationKind: 'board_up',
        state: 'MO',
        pullDate: '2026-11-14',
        fileName: '311.csv',
        csv: 'case_number,city,state,zip_code\n2024-00016,Kansas City,MO,64118\n',
      }),
    }))
    expect(accepted.status).toBe(201)
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls[0][1].p_imported_by).toBe('box-script')
    expect(mocks.rpc.mock.calls[0][1].p_rows[0].county).toBe('clay')
    delete process.env.CRON_SECRET
  })

  it('requires a signed-in user and refuses the review sandbox', async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await POST(request({}))).status).toBe(401)
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.sandbox.mockResolvedValue('sandbox-lead')
    expect((await POST(request({}))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('records the file and upserts duplicate parcels as one row', async () => {
    const response = await POST(request({
      listType: 'tax_delinquent',
      county: 'clay',
      state: 'MO',
      pullDate: '2026-11-14',
      fileName: 'clay.csv',
      csv: 'parcel_id,owner_name\nC1,Ada\nC1,Ada Updated\n',
    }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ success: true, sourceListId: 'list-1', inserted: 1 })
    const args = mocks.rpc.mock.calls[0][1]
    expect(mocks.rpc.mock.calls[0][0]).toBe('import_source_list_v1')
    expect(args.p_source_file_name).toBe('clay.csv')
    expect(args.p_source_file_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(args.p_rows).toHaveLength(1)
    expect(args.p_rows[0].owner_names).toBe('Ada Updated')
  })

  it('does not call the database for an empty file', async () => {
    const response = await POST(request({
      listType: 'tax_delinquent',
      county: 'clay',
      state: 'MO',
      pullDate: '2026-11-14',
      fileName: 'clay.csv',
      csv: '',
    }))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
