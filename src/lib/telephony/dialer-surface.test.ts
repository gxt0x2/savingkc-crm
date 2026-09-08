import { describe, expect, it } from 'vitest'
import { dialerCallIntentEndpoint } from './dialer-surface'

describe('dialer surface routing', () => {
  it('uses different server-owned authorization endpoints', () => {
    expect(dialerCallIntentEndpoint('crm')).toBe('/api/crm/call-intents')
    expect(dialerCallIntentEndpoint('prospecting')).toBe('/api/prospecting/call-intents')
  })
})
