import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import { createHash } from 'node:crypto'
import { serializeMojoSource } from '@/lib/mojo-source-identity.mjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), upsert: vi.fn(), update: vi.fn(), result: { data: null as unknown, error: null as unknown, count: 1 as number | null } }))
vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const builder = {
    upsert: mocks.upsert, update: mocks.update,
    select: () => builder, eq: () => builder, is: () => builder, in: () => builder,
    order: () => builder, limit: () => builder, maybeSingle: () => builder, single: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.result).then(resolve),
  }
  mocks.update.mockReturnValue(builder)
  return { from: () => builder }
} }))
import { POST, GET, PATCH } from './route'
const payload = { runtime: { revision: 'test-revision', contentDigest: expectedRuntime.contentDigest }, version: 'source-receipts-v1', since: '2026-09-03T05:00:00Z', to: '2026-09-10', activities: [[1, 11, 'Casey', '09/10/2026 10:00 AM', { group_name: 'Do Not Call' }]], recordings: [] }
const id = createHash('sha256').update(serializeMojoSource(payload)).digest('hex')
function request(method: string, body?: unknown) { return new Request('https://crm.savingkc.com/api/admin/mojo-source-batches', { method, ...(body ? { body: JSON.stringify({ runtime: payload.runtime, ...(body as Record<string, unknown>) }) } : {}) }) as never }
describe('Mojo private source archive', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.upsert.mockResolvedValue({ error: null })
    mocks.result = { data: { id, accepted_at: null }, error: null, count: 1 }
  })
  it.each([POST, GET, PATCH])('requires authorization before reading or writing source evidence', async handler => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    expect((await handler(request('POST', {}))).status).toBe(401)
    expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it('archives the exact source with an immutable duplicate policy', async () => {
    const response = await POST(request('POST', { id, payload }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, id, accepted: false })
    expect(mocks.upsert).toHaveBeenCalledWith({ id, payload, runtime_version: 'test-revision' }, { onConflict: 'id', ignoreDuplicates: true })
  })
  it('rejects a stale runtime even when its source checksum is correct', async () => {
    const stale = { ...payload, runtime: { ...payload.runtime, contentDigest: '0'.repeat(64) } }
    const staleId = createHash('sha256').update(serializeMojoSource(stale)).digest('hex')
    expect((await POST(request('POST', { id: staleId, payload: stale, runtime: stale.runtime }))).status).toBe(409)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('allows the current runtime to replay immutable source captured by an older runtime', async () => {
    const oldSource = { ...payload, runtime: { revision: 'old-source', contentDigest: 'a'.repeat(64) } }
    const oldId = createHash('sha256').update(serializeMojoSource(oldSource)).digest('hex')
    expect((await POST(request('POST', { id: oldId, payload: oldSource }))).status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ payload: oldSource }), expect.anything())
  })
  it('rejects a checksum mismatch without writing', async () => {
    expect((await POST(request('POST', { id, payload: { ...payload, recordings: [1] } }))).status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('cannot complete a batch whose projected records are missing', async () => {
    mocks.result.count = 0
    expect((await PATCH(request('PATCH', { id, recordIds: ['missing'] }))).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('retains a bounded failure reason for recovery without completing the batch', async () => {
    expect((await PATCH(request('PATCH', { id, error: 'Contact lookup failed' }))).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ last_error: 'Contact lookup failed' })
  })
})
