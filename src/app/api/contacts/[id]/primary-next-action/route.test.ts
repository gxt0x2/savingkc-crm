import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}))

import { GET, POST } from './route'

const LEAD_ID = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id: LEAD_ID }) }

function post(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request(`https://crm.savingkc.com/api/contacts/${LEAD_ID}/primary-next-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('primary next-action human review route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('requires an authenticated actor before reading review state', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await GET(new Request('https://crm.savingkc.com'), context)

    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns the server-owned candidate review without caching it', async () => {
    mocks.rpc.mockResolvedValue({ data: { resolutionKind: 'select', candidates: [{ key: 'activity:1' }] }, error: null })

    const response = await GET(new Request('https://crm.savingkc.com'), context)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(payload.review.resolutionKind).toBe('select')
    expect(mocks.rpc).toHaveBeenCalledWith('primary_next_action_review_v1', { p_lead_id: LEAD_ID })
  })

  it('attributes selection to the authenticated actor and forwards the locked version', async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true, resolution: 'select_existing', review: { resolutionKind: 'resolved' } }, error: null })

    const response = await POST(post({
      action: 'select_existing',
      workItemKey: 'activity:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedVersion: 3,
      actor: 'Spoofed Agent',
    }, { 'idempotency-key': 'review-selection-1' }), context)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_primary_next_action_v1', expect.objectContaining({
      p_actor: 'Casey',
      p_action: 'select_existing',
      p_expected_version: 3,
      p_idempotency_key: 'review-selection-1',
    }))
  })

  it('creates only an owned and dated reviewed task', async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true, resolution: 'create', review: { resolutionKind: 'resolved' } }, error: null })

    const response = await POST(post({
      action: 'create',
      title: 'Call seller with updated offer',
      dueAt: '2026-08-24T15:00:00.000Z',
      assignedTo: 'Gertha',
      kind: 'callback',
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_primary_next_action_v1', expect.objectContaining({
      p_actor: 'Casey',
      p_assigned_to: 'Gertha',
      p_due_at: '2026-08-24T15:00:00.000Z',
      p_kind: 'callback',
    }))
  })

  it('rejects an undated task before calling the database', async () => {
    const response = await POST(post({ action: 'create', title: 'Call seller', assignedTo: 'Casey' }), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'A valid due date is required.' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('maps a stale candidate to a safe conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'primary_candidate_not_eligible' } })

    const response = await POST(post({ action: 'select_existing', workItemKey: 'activity:1', expectedVersion: 1 }), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('no longer eligible') })
  })
})
