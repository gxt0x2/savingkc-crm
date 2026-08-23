import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  admin: vi.fn(),
  finalizeFundedClose: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/server/crm-operating-handoffs', () => ({ finalizeFundedClose: mocks.finalizeFundedClose }))

import { POST } from './route'

describe('Dispositions closeout trust boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an anonymous request before parsing the body or touching the database', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new NextRequest('https://crm.savingkc.com/api/dispo-deals/deal-1/closeout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'deal-1' }) })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.finalizeFundedClose).not.toHaveBeenCalled()
  })

  it('uses the verified actor and governed closeout service instead of client actor fields', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./route.ts', import.meta.url), 'utf8'))
    expect(source).toContain('recordedBy: actor.name')
    expect(source).toContain('completedBy: actor.name')
    expect(source).toContain('await finalizeFundedClose({')
    expect(source).not.toContain("rpc('exec_sql'")
    expect(source).not.toContain('cleanText(body.recordedBy)')
    expect(source).not.toContain('cleanText(body.completedBy)')
  })
})
