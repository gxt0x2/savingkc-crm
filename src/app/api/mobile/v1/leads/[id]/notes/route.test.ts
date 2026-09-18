import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), reserve: vi.fn(), complete: vi.fn(), admin: vi.fn(), single: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor }))
vi.mock('@/lib/mobile-api/command-receipts', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/command-receipts')>(), reserveMobileCommand: mocks.reserve, completeMobileCommand: mocks.complete,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
import { POST } from './route'

describe('mobile lead notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.complete.mockResolvedValue(undefined)
    mocks.single.mockResolvedValue({ data: { id: 'note-1', lead_id: 'lead-1', description: 'Seller called', agent: 'Casey', created_at: '2026-09-18T16:00:00Z' }, error: null })
    mocks.admin.mockReturnValue({ from: () => ({ insert: () => ({ select: () => ({ single: mocks.single }) }) }) })
  })
  it('persists once with actor and returns the canonical activity', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1/notes', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'note-create-1' }, body: JSON.stringify({ description: 'Seller called' }),
    }), { params: Promise.resolve({ id: 'lead-1' }) })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ success: true, activity: { id: 'note-1', agent: 'Casey' } })
    expect(mocks.complete).toHaveBeenCalled()
  })
  it('replays the stored result without another insert', async () => {
    mocks.reserve.mockResolvedValue({ kind: 'replay', status: 201, result: { success: true, activity: { id: 'note-1' } } })
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1/notes', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'note-create-1' }, body: JSON.stringify({ description: 'Seller called' }),
    }), { params: Promise.resolve({ id: 'lead-1' }) })
    expect(response.status).toBe(201)
    expect(mocks.single).not.toHaveBeenCalled()
  })
})
