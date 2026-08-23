import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), actor: vi.fn(), read: vi.fn(), attest: vi.fn() }))
vi.mock('@/lib/api/require-authenticated-user', () => ({ requireAuthenticatedUser: mocks.auth }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/lifecycle-reconciliation', () => ({ getLifecycleReconciliationSnapshot: mocks.read }))
vi.mock('@/lib/server/crm-operating-handoffs', () => ({ attestLegacyHandoff: mocks.attest }))

describe('lifecycle reconciliation route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' }) })

  it('returns the no-store governed evidence snapshot', async () => {
    mocks.read.mockResolvedValue({ generatedAt: '2026-08-23T18:00:00.000Z', degraded: false, counts: {}, issues: [] })
    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('server-timing')).toContain('lifecycle-reconciliation')
  })

  it('does not touch evidence data when the request is unauthenticated', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const { GET } = await import('./route')
    expect((await GET()).status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('records a confirmed attestation with the verified server actor', async () => {
    mocks.attest.mockResolvedValue({ handoffId: '11111111-1111-4111-8111-111111111111', status: 'accepted' })
    const { POST } = await import('./route')
    const response = await POST(new (await import('next/server')).NextRequest('https://crm.savingkc.com/api/reports/lifecycle-reconciliation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        kind: 'seller_handoff', leadId: '11111111-1111-4111-8111-111111111111', recordId: '22222222-2222-4222-8222-222222222222',
        candidateId: null, evidenceReference: 'Signed contract in title file 88', evidenceOccurredAt: '2026-08-01T17:00:00.000Z', confirmed: true,
        actorName: 'Spoofed',
      }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.attest).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: 'casey@savingkc.com', actorName: 'Casey' }))
    expect(mocks.attest.mock.calls[0][0]).not.toHaveProperty('confirmed')
  })

  it('rejects incomplete evidence before invoking the command', async () => {
    const { POST } = await import('./route')
    const response = await POST(new (await import('next/server')).NextRequest('https://crm.savingkc.com/api/reports/lifecycle-reconciliation', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(400)
    expect(mocks.attest).not.toHaveBeenCalled()
  })
})
