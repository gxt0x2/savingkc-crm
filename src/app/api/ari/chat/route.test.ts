import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAuthenticatedUser: vi.fn() }))

vi.mock('@/lib/api/require-authenticated-user', () => ({ requireAuthenticatedUser: mocks.requireAuthenticatedUser }))

import { POST } from './route'

describe('retired lead-level ARI chat', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects unauthenticated requests before exposing the replacement', async () => {
    mocks.requireAuthenticatedUser.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const response = await POST()
    expect(response.status).toBe(401)
  })

  it('directs signed-in callers to the governed unified assistant', async () => {
    mocks.requireAuthenticatedUser.mockResolvedValue(null)
    const response = await POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: 'ari_chat_retired',
      replacement: '/api/ai/command',
    }))
  })
})
