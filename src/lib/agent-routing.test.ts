import { describe, expect, it } from 'vitest'
import { getAgentRouting } from './agent-routing'

describe('agent routing', () => {
  it('routes the dispositions number to Ernest first', () => {
    const routing = getAgentRouting('+18166088858')

    expect(routing.primary.name).toBe('Ernest')
    expect(routing.secondary.name).toBe('Casey')
  })
})
