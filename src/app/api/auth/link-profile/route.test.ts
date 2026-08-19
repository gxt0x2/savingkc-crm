import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getCurrentUserEmail: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  insertSingle: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST } from './route'

function request(body: Record<string, unknown> | string) {
  return new NextRequest('https://crm.savingkc.com/api/auth/link-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('link-profile identity containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUserEmail.mockResolvedValue('agent@savingkc.com')
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.insertSingle.mockResolvedValue({ data: { id: 'profile-new' }, error: null })
    mocks.insert.mockImplementation(() => ({
      select: () => ({ single: mocks.insertSingle }),
    }))
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
      insert: mocks.insert,
    })
  })

  it('rejects an anonymous request before parsing or database access', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an attempt to link a different email', async () => {
    const response = await POST(request({
      email: 'owner@savingkc.com',
      name: 'Owner',
      phone: '+18165550123',
    }))

    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects a non-object JSON body before database access', async () => {
    const response = await POST(request('null'))

    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('links only an existing exact-email profile without mutating it', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'profile-existing' }, error: null })

    const response = await POST(request({
      email: 'AGENT@savingkc.com',
      name: 'Another Profile Name',
      phone: '+18165550123',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ linked: true, profileId: 'profile-existing' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('creates a least-privilege profile for the authenticated identity when absent', async () => {
    const response = await POST(request({
      email: 'agent@savingkc.com',
      name: '  New   Agent  ',
      phone: '+18165550123',
      role: 'owner',
      is_admin: true,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ linked: true, profileId: 'profile-new', created: true })
    expect(mocks.insert).toHaveBeenCalledWith({
      email: 'agent@savingkc.com',
      full_name: 'New Agent',
      role: 'agent',
      is_admin: false,
    })
  })
})
