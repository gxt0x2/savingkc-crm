import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAuthenticatedUser: vi.fn() }))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}))

import { POST as analyzeDeal } from './deal-score-analysis/route'
import { POST as extractPainPoints } from './extract-pain-points/route'

describe('retired direct-provider ARI routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['deal score', analyzeDeal],
    ['pain points', extractPainPoints],
  ])('rejects unauthenticated %s requests', async (_label, handler) => {
    mocks.requireAuthenticatedUser.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const response = await handler()

    expect(response.status).toBe(401)
  })

  it.each([
    ['deal score', analyzeDeal, 'ari_deal_score_analysis_retired'],
    ['pain points', extractPainPoints, 'ari_pain_point_extraction_retired'],
  ])('sends signed-in %s callers to the governed assistant', async (_label, handler, code) => {
    mocks.requireAuthenticatedUser.mockResolvedValue(null)

    const response = await handler()

    expect(response.status).toBe(410)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code,
      replacement: '/api/ai/command',
    }))
  })
})
