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
