import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), lookup: vi.fn(), image: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  requireAuthorizedMobileLead: mocks.authorize,
}))
vi.mock('@/lib/mobile-api/street-view', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/street-view')>(),
  lookupStreetView: mocks.lookup,
  fetchStreetViewImage: mocks.image,
}))

import { GET } from './route'

const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id }) }
function request(pano: string) {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${id}/street-view/image?pano=${pano}&heading=90`, {
    headers: { Authorization: 'Bearer user' },
  })
}

describe('mobile Street View image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ lead: { id } })
    mocks.lookup.mockResolvedValue({ available: true, panoId: 'pano-current', heading: 90 })
    mocks.image.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }))
  })

  it('returns 409 if the selected panorama changed between JSON and image fetch', async () => {
    const response = await GET(request('pano-old'), context)
    expect(response.status).toBe(409)
    expect(mocks.image).not.toHaveBeenCalled()
  })

  it('renders only the selected matching panorama after actor authorization', async () => {
    const response = await GET(request('pano-current'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.image).toHaveBeenCalledWith('pano-current', 90)
  })
})
