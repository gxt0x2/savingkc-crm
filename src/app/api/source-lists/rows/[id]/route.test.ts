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

import { PATCH } from './route'

const rowId = '11111111-1111-4111-8111-111111111111'

describe('PATCH /api/source-lists/rows/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.sandbox.mockResolvedValue(null)
    mocks.rpc.mockResolvedValue({
      data: { id: rowId, status: 'excluded_entity', status_reason: 'llc' },
      error: null,
    })
  })

  it('records an entity exclusion and does not touch the dialer queue', async () => {
    const response = await PATCH(new NextRequest('https://crm.savingkc.com/api/source-lists/rows/' + rowId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'excluded_entity', statusReason: 'llc' }),
    }), { params: Promise.resolve({ id: rowId }) })
    expect(response.status).toBe(200)
    expect(mocks.rpc.mock.calls[0][0]).toBe('set_source_list_row_status_v1')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_status: 'excluded_entity', p_status_reason: 'llc' })
  })

  it('rejects an unknown status before calling the database', async () => {
    const response = await PATCH(new NextRequest('https://crm.savingkc.com/api/source-lists/rows/' + rowId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'call_them' }),
    }), { params: Promise.resolve({ id: rowId }) })
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
