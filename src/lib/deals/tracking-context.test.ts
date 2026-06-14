import { describe, expect, it, vi } from 'vitest'
import { getDealTrackingRequestContext, isSchemaColumnError, legacyHashedValue } from './tracking-context'

describe('deal tracking context', () => {
  it('hashes IP and user agent instead of exposing raw values', () => {
    vi.stubEnv('DEAL_TRACKING_SALT', 'test-salt')

    const context = getDealTrackingRequestContext({
      headers: new Headers({
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
        'accept-language': 'en-US,en;q=0.9',
      }),
    })

    expect(context.ipHash).toMatch(/^[a-f0-9]{64}$/)
    expect(context.userAgentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(context.payload.device_type).toBe('mobile')
    expect(context.payload.device_platform).toBe('iOS')
    expect(context.payload.accept_language).toBe('en-US,en;q=0.9')
    expect(context.ipHash).not.toContain('203.0.113.10')

    vi.unstubAllEnvs()
  })

  it('marks configured internal traffic', () => {
    vi.stubEnv('DEAL_INTERNAL_IPS', '203.0.113.0/24')

    const context = getDealTrackingRequestContext({
      headers: new Headers({
        'cf-connecting-ip': '203.0.113.55',
        'user-agent': 'Mozilla/5.0',
      }),
    })

    expect(context.isInternal).toBe(true)
    expect(context.payload.internal_reasons).toContain('ip_match')

    vi.unstubAllEnvs()
  })

  it('formats legacy hashed placeholders', () => {
    expect(legacyHashedValue('ip', 'a'.repeat(64))).toBe(`sha256:ip:${'a'.repeat(32)}`)
    expect(legacyHashedValue('ua', null)).toBeNull()
  })

  it('recognizes schema cache column errors', () => {
    expect(isSchemaColumnError({ code: 'PGRST204', message: 'Could not find the ip_hash column' })).toBe(true)
    expect(isSchemaColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false)
  })
})
