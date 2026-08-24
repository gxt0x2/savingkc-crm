import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), apply: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/server/crm-lifecycle', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/crm-lifecycle')>(), applyCrmLifecycleCommand: mocks.apply,
}))

import { POST } from './route'

const context = { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) }
function request(owner: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/x/owner', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    body: JSON.stringify({ owner, actor: 'Spoofed' }),
  })
}

describe('mobile contact owner mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.apply.mockResolvedValue({ owner: 'Ernest' })
  })

  it('uses the canonical lifecycle command and verified bearer actor', async () => {
    const response = await POST(request('Ernest'), context)

    expect(response.status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'assign', owner: 'Ernest', actorEmail: 'casey@savingkc.com', actorName: 'Casey',
    }))
  })

  it('rejects a fabricated owner before lifecycle mutation', async () => {
    const response = await POST(request('Marketing'), context)

    expect(response.status).toBe(403)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('rejects an invalid bearer before parsing owner data', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.actor.mockRejectedValue(new MobileAuthError('Invalid bearer token'))
    const req = request('Ernest')
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
