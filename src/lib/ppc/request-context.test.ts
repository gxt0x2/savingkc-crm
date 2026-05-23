import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPpcRequestContext } from './request-context'

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

describe('ppc request context', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stores private request hashes and coarse device fields without raw IP', () => {
    vi.stubEnv('PPC_TRACKING_SALT', 'unit-test-salt')

    const context = getPpcRequestContext(request({
      'x-forwarded-for': '203.0.113.44, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    }))

    expect(context.isInternal).toBe(false)
    expect(context.devicePayload.ip_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(context.devicePayload.user_agent_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(context.devicePayload.device_platform).toBe('macOS')
    expect(context.devicePayload.device_type).toBe('desktop')
    expect(context.devicePayload).not.toHaveProperty('ip')
    expect(context.devicePayload).not.toHaveProperty('user_agent')
  })

  it('marks configured internal IP traffic as internal test traffic', () => {
    vi.stubEnv('PPC_TRACKING_SALT', 'unit-test-salt')
    vi.stubEnv('PPC_INTERNAL_IPS', '203.0.113.44')

    const context = getPpcRequestContext(request({
      'x-forwarded-for': '203.0.113.44',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
    }))

    expect(context.isInternal).toBe(true)
    expect(context.internalReasons).toContain('ip_match')
    expect(context.devicePayload.device_platform).toBe('iOS')
    expect(context.devicePayload.device_type).toBe('mobile')
    expect(context.devicePayload.is_internal).toBe(true)
  })

  it('normalizes IPv4-mapped forwarded addresses before matching internal IPs', () => {
    vi.stubEnv('PPC_INTERNAL_IPS', '203.0.113.44')

    const context = getPpcRequestContext(request({
      'x-forwarded-for': '::ffff:203.0.113.44',
    }))

    expect(context.isInternal).toBe(true)
    expect(context.internalReasons).toContain('ip_match')
  })

  it('normalizes IPv4-mapped forwarded addresses with ports', () => {
    vi.stubEnv('PPC_INTERNAL_IPS', '203.0.113.44')

    const context = getPpcRequestContext(request({
      'x-forwarded-for': '::ffff:203.0.113.44:52110',
    }))

    expect(context.isInternal).toBe(true)
    expect(context.internalReasons).toContain('ip_match')
  })

  it('supports IPv4 CIDR internal rules', () => {
    vi.stubEnv('PPC_INTERNAL_IPS', '198.51.100.0/24')

    expect(getPpcRequestContext(request({ 'x-forwarded-for': '198.51.100.9' })).isInternal).toBe(true)
    expect(getPpcRequestContext(request({ 'x-forwarded-for': '198.51.101.9' })).isInternal).toBe(false)
  })
})
