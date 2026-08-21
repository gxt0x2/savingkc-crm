import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getAll: vi.fn(),
  getCategory: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({ requireAuthenticatedUser: mocks.auth }))
vi.mock('@/lib/sms-templates', () => ({
  getAllTemplates: mocks.getAll,
  getTemplatesByCategory: mocks.getCategory,
}))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { GET, POST } from './route'

describe('/api/sms-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
  })

  it('rejects unauthenticated reads before template access', async () => {
    const unauthorized = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mocks.auth.mockResolvedValue(unauthorized)

    const response = await GET(new Request('https://crm.savingkc.com/api/sms-templates'))

    expect(response).toBe(unauthorized)
    expect(mocks.getAll).not.toHaveBeenCalled()
    expect(mocks.getCategory).not.toHaveBeenCalled()
  })

  it('returns the authenticated category library without public caching', async () => {
    mocks.getCategory.mockResolvedValue([{ id: 'template-1' }])

    const response = await GET(new Request('https://crm.savingkc.com/api/sms-templates?category=prospecting_intro'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ templates: [{ id: 'template-1' }] })
    expect(mocks.getCategory).toHaveBeenCalledWith('prospecting_intro')
  })

  it('rejects unauthenticated writes before parsing or database access', async () => {
    const unauthorized = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mocks.auth.mockResolvedValue(unauthorized)
    const request = new Request('https://crm.savingkc.com/api/sms-templates', { method: 'POST', body: '{not-json' })

    const response = await POST(request)

    expect(response).toBe(unauthorized)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('publishes an authenticated reviewed template', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'template-1', name: 'heir_intro' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const upsert = vi.fn().mockReturnValue({ select })
    mocks.from.mockReturnValue({ upsert })

    const response = await POST(new Request('https://crm.savingkc.com/api/sms-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'heir_intro',
        category: 'prospecting_intro',
        body: 'Hi {firstName}. Reply STOP to opt out.',
        merge_fields: ['{firstName}', '{firstName}'],
      }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ template: { id: 'template-1', name: 'heir_intro' } })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'heir_intro',
      category: 'prospecting_intro',
      merge_fields: ['{firstName}'],
      is_active: true,
    }), { onConflict: 'name' })
  })
})
