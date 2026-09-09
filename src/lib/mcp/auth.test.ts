import { afterEach, describe, expect, it, vi } from 'vitest'
import { configuredCrmMcpActorEmail, isValidCrmMcpToken, verifyCrmMcpToken } from './auth'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CRM MCP authentication', () => {
  it('fails closed when the server token is not configured', () => {
    vi.stubEnv('CRM_MCP_TOKEN', '')
    expect(isValidCrmMcpToken('anything')).toBe(false)
  })

  it('rejects missing and incorrect bearer tokens', () => {
    vi.stubEnv('CRM_MCP_TOKEN', 'configured-secret')
    expect(isValidCrmMcpToken(undefined)).toBe(false)
    expect(isValidCrmMcpToken('wrong-secret')).toBe(false)
  })

  it('accepts the existing assistant service credential during rollout', () => {
    vi.stubEnv('CRM_MCP_TOKEN', '')
    vi.stubEnv('CRM_ASSISTANT_API_SECRET', 'assistant-service-secret')
    expect(isValidCrmMcpToken('assistant-service-secret')).toBe(true)
  })

  it('maps a valid token to the configured CRM actor and read scope', () => {
    vi.stubEnv('CRM_MCP_TOKEN', 'configured-secret')
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', 'Owner@SavingKC.com ')

    expect(configuredCrmMcpActorEmail()).toBe('owner@savingkc.com')
    expect(verifyCrmMcpToken(new Request('https://crm.savingkc.com/api/mcp'), 'configured-secret')).toMatchObject({
      clientId: 'savingkc-grok-build',
      scopes: ['crm:read'],
      extra: { email: 'owner@savingkc.com' },
    })
  })

  it('falls back to the first configured owner identity', () => {
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', '')
    vi.stubEnv('CRM_ASSISTANT_OWNER_EMAILS', 'Ernest@SavingKC.com, casey@savingkc.com')
    expect(configuredCrmMcpActorEmail()).toBe('ernest@savingkc.com')
  })
})
