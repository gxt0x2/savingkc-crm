import { describe, expect, it } from 'vitest'

import { POST as advance } from './advance/route'
import { POST as validate } from './validate/route'

describe('legacy stage route retirement', () => {
  it.each([
    ['advance', advance],
    ['validate', validate],
  ])('keeps the old %s route fail-closed and names the canonical replacement', async (_name, handler) => {
    const response = await handler()
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Legacy stage advancement is retired. Use the governed contact lifecycle action.',
      code: 'legacy_stage_route_retired',
      replacement: '/api/leads/[id]/lifecycle',
    })
  })
})
