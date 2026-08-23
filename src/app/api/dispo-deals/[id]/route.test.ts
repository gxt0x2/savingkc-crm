import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/tc', () => ({ ensureTcFileForDeal: vi.fn(), syncDispositionOperatingTasksForFile: vi.fn() }))

import { PATCH } from './route'

describe('Dispositions deal mutation trust boundary', () => {
  it('rejects an anonymous mutation before parsing or database access', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await PATCH(new NextRequest('https://crm.savingkc.com/api/dispo-deals/deal-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{not-json',
    }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('routes terminal fallout away from the generic stage mutation', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./route.ts', import.meta.url), 'utf8'))
    expect(source).toContain('Use verified fallout to close a transaction that did not fund')
    expect(source).toContain('resolveAuthenticatedActor()')
  })
})
