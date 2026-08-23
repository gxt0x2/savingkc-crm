import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  actor: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireUser,
}))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

import { GET, PATCH } from './route'

const context = { params: Promise.resolve({ id: 'manifest-1' }) }

describe('legacy manifest item trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(null)
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('rejects anonymous reads before creating a service-role client', async () => {
    mocks.requireUser.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const response = await GET(
      new NextRequest('https://crm.savingkc.com/api/manifests/manifest-1'),
      context,
    )

    expect(response.status).toBe(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('rejects anonymous patches before parsing or service-role access', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = new NextRequest('https://crm.savingkc.com/api/manifests/manifest-1', {
      method: 'PATCH',
      body: JSON.stringify({ agent: 'Spoofed Agent', action: 'fake_event' }),
    })
    const parse = vi.spyOn(req, 'json')

    const response = await PATCH(req, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('uses fixed compatibility action and server-owned actor fields', () => {
    const source = readFileSync('src/app/api/manifests/[id]/route.ts', 'utf8')
    expect(source).toContain("const action = 'legacy_manifest_updated'")
    expect(source).toContain('agent: actor.name')
    expect(source).toContain('merged.lastUpdatedBy = actor.name')
    expect(source).toContain('actor: actor.name')
    expect(source).not.toContain('requestedAgent')
  })
})
