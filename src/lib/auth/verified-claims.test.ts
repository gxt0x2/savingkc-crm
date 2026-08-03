import { describe, expect, it } from 'vitest'

import { hasVerifiedSubject } from './verified-claims'

describe('hasVerifiedSubject', () => {
  it('accepts a successfully verified authenticated subject', () => {
    expect(hasVerifiedSubject({ data: { claims: { sub: 'user-123' } }, error: null })).toBe(true)
  })

  it('rejects failed, missing, and malformed claims', () => {
    expect(hasVerifiedSubject({ data: null, error: null })).toBe(false)
    expect(hasVerifiedSubject({ data: { claims: {} }, error: null })).toBe(false)
    expect(hasVerifiedSubject({ data: { claims: { sub: '' } }, error: null })).toBe(false)
    expect(hasVerifiedSubject({ data: { claims: { sub: 'user-123' } }, error: new Error('invalid token') })).toBe(false)
  })
})
