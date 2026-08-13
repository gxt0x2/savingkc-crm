import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  loadCaseyMyDay: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/my-day-server', () => ({
  loadCaseyMyDay: mocks.loadCaseyMyDay,
}))

import { GET } from './route'

function request(month = '2026-08') {
  return new NextRequest(`https://crm.savingkc.com/api/my-day?month=${month}`)
}

describe('Casey My Day API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadCaseyMyDay.mockResolvedValue({ month: '2026-08', agent: { name: 'Casey' } })
  })

  it('returns Casey data to Casey only', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('casey@savingkc.com')

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.loadCaseyMyDay).toHaveBeenCalledWith('2026-08')
    await expect(response.json()).resolves.toMatchObject({ month: '2026-08' })
  })

  it('conceals the workspace from every other signed-in user', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('ernest@savingkc.com')

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(mocks.loadCaseyMyDay).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.loadCaseyMyDay).not.toHaveBeenCalled()
  })
})
