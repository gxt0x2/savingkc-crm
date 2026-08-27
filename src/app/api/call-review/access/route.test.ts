import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCurrentUserEmail: vi.fn() }))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

import { GET } from './route'

describe('call review access', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['ernest@savingkc.com', 'gertha@savingkc.com'])('allows explicit reviewer %s', async (email) => {
    mocks.getCurrentUserEmail.mockResolvedValue(email)

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ canReviewCalls: true })
  })

  it('denies Casey even when she is otherwise an authenticated CRM user', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('casey@savingkc.com')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ canReviewCalls: false })
  })

  it('rejects an unauthenticated request', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ canReviewCalls: false })
  })
})
