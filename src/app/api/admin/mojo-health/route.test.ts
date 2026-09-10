import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), health: vi.fn(), persist: vi.fn(), incident: vi.fn() }))
vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/marketing/mojo-health', () => ({ getMojoHealth: mocks.health, persistMojoHealth: mocks.persist }))
vi.mock('@/lib/server/mojo-health-incident', () => ({ recordMojoHealthIncident: mocks.incident }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))
import { GET } from './route'

function health() {
  return {
    status: 'attention', message: 'CRM reconciliation has 6 unresolved issues',
    sessionStatus: 'healthy', syncHealth: 'healthy', businessHours: true, lastSyncAgeMinutes: 10,
    runtime: { verified: true }, performance: { status: 'current' },
    queue: { failed24h: 0, deadLetter: 0 }, qualification: { recordingFailed7d: 0 },
    reconciliation: { message: 'CRM reconciliation has 6 unresolved issues', issueCount: 6,
      checkedAt: '2026-09-10T21:35:00Z', error: null, counts: { evidencePendingAllAges: 6, queueOverdue: 0 } },
  }
}

describe('Mojo health alert transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.health.mockResolvedValue(health())
    mocks.persist.mockResolvedValue(undefined)
    mocks.incident.mockResolvedValue({ created: true, alerted: false })
  })

  it('persists review attention without creating an outage incident or sending its SMS', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/admin/mojo-health'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ health: { reconciliation: { issueCount: 6 } }, alert: { kind: 'evidence_review' } })
    expect(mocks.persist).toHaveBeenCalledOnce()
    expect(mocks.incident).not.toHaveBeenCalled()
  })

  it('still creates an incident for a real failure alongside historical holds', async () => {
    mocks.health.mockResolvedValue({ ...health(), syncHealth: 'down', lastError: 'Source intake failed' })
    await GET(new NextRequest('https://crm.savingkc.com/api/admin/mojo-health'))
    expect(mocks.incident).toHaveBeenCalledWith({}, expect.objectContaining({ message: 'Source intake failed' }))
  })

  it('exposes the same decision in read-only mode without side effects', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/admin/mojo-health?dryRun=1'))
    expect(await response.json()).toMatchObject({ dryRun: true, alert: { kind: 'evidence_review' } })
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(mocks.incident).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated monitor requests', async () => {
    mocks.auth.mockResolvedValue(new Response(null, { status: 401 }))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/admin/mojo-health'))
    expect(response.status).toBe(401)
    expect(mocks.health).not.toHaveBeenCalled()
  })
})
