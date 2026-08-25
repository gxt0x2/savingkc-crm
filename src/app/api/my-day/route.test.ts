import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessCaseyMyDay: vi.fn(),
  getCurrentUserEmail: vi.fn(),
  loadCaseyMyDay: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/my-day-server', () => ({
  canAccessCaseyMyDay: mocks.canAccessCaseyMyDay,
  loadCaseyMyDay: mocks.loadCaseyMyDay,
}))

import { GET } from './route'

function request(query = 'range=today') {
  return new NextRequest(`https://crm.savingkc.com/api/my-day?${query}`)
}

describe('Casey My Day API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canAccessCaseyMyDay.mockResolvedValue(false)
    mocks.loadCaseyMyDay.mockResolvedValue({ month: '2026-08', agent: { name: 'Casey' } })
  })

  it('returns Casey data to Casey', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('casey@savingkc.com')
    mocks.canAccessCaseyMyDay.mockResolvedValue(true)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.loadCaseyMyDay).toHaveBeenCalledWith({ preset: 'today', from: null, to: null, month: null })
    await expect(response.json()).resolves.toMatchObject({ month: '2026-08' })
  })

  it('allows an admin to review Casey data from the direct URL', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('ernest@savingkc.com')
    mocks.canAccessCaseyMyDay.mockResolvedValue(true)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.canAccessCaseyMyDay).toHaveBeenCalledWith('ernest@savingkc.com')
    expect(mocks.loadCaseyMyDay).toHaveBeenCalledWith({ preset: 'today', from: null, to: null, month: null })
  })

  it('conceals the workspace from every other signed-in user', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('gertha@savingkc.com')

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(mocks.canAccessCaseyMyDay).toHaveBeenCalledWith('gertha@savingkc.com')
    expect(mocks.loadCaseyMyDay).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.loadCaseyMyDay).not.toHaveBeenCalled()
  })

  it('passes a bounded custom range through to the server model', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('casey@savingkc.com')
    mocks.canAccessCaseyMyDay.mockResolvedValue(true)

    const response = await GET(request('range=custom&from=2026-08-01&to=2026-08-24'))

    expect(response.status).toBe(200)
    expect(mocks.loadCaseyMyDay).toHaveBeenCalledWith({
      preset: 'custom',
      from: '2026-08-01',
      to: '2026-08-24',
      month: null,
    })
  })
})
