import { beforeEach, describe, expect, it, vi } from 'vitest'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), incident: vi.fn() }))
vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/mojo-health-incident', () => ({ recordMojoHealthIncident: mocks.incident }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))
import { POST } from './route'
describe('Mojo incident writer ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.incident.mockResolvedValue({ created: true, alerted: false }) })
  const body = { message: 'Sync failed', reason: 'sync_failed', source: 'mojo-supervised-runner' }
  it('does not let a retired writer raise an incident or send an alert', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-incident', { method: 'POST', body: JSON.stringify(body) }) as never)
    expect(response.status).toBe(409)
    expect(mocks.incident).not.toHaveBeenCalled()
  })
  it('retains current supervised incident reporting', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-incident', { method: 'POST', headers: { 'x-mojo-runtime-digest': expectedRuntime.contentDigest }, body: JSON.stringify(body) }) as never)
    expect(response.status).toBe(200)
    expect(mocks.incident).toHaveBeenCalledWith({}, body)
  })
})
