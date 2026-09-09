import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

import {
  configuredCrmMcpActorEmail,
  isConfiguredCrmMcpActorEmail,
  isValidCrmMcpToken,
  verifyCrmMcpToken,
} from './auth'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
})

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

  it('maps a valid static token to the configured CRM actor and read scopes', async () => {
    vi.stubEnv('CRM_MCP_TOKEN', 'configured-secret')
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', 'Owner@SavingKC.com ')

    expect(configuredCrmMcpActorEmail()).toBe('owner@savingkc.com')
    expect(await verifyCrmMcpToken(new Request('https://crm.savingkc.com/api/mcp'), 'configured-secret')).toMatchObject({
      clientId: 'savingkc-grok-build',
      scopes: ['crm:read', 'email'],
      extra: { email: 'owner@savingkc.com' },
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('falls back to the first configured owner identity', () => {
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', '')
    vi.stubEnv('CRM_ASSISTANT_OWNER_EMAILS', 'Ernest@SavingKC.com, casey@savingkc.com')
    expect(configuredCrmMcpActorEmail()).toBe('ernest@savingkc.com')
  })

  it('compares the OAuth identity with the configured CRM actor', () => {
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', 'Owner@SavingKC.com ')
    expect(isConfiguredCrmMcpActorEmail('owner@savingkc.com')).toBe(true)
    expect(isConfiguredCrmMcpActorEmail('casey@savingkc.com')).toBe(false)
  })

  it('accepts a verified Supabase OAuth token for the configured actor', async () => {
    vi.stubEnv('CRM_MCP_TOKEN', 'configured-secret')
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', 'owner@savingkc.com')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-key')
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          client_id: 'cursor-oauth-client',
          email: 'Owner@SavingKC.com',
        },
      },
      error: null,
    })

    await expect(verifyCrmMcpToken(
      new Request('https://crm.savingkc.com/api/mcp'),
      'supabase-oauth-token',
    )).resolves.toMatchObject({
      clientId: 'cursor-oauth-client',
      scopes: ['email'],
      extra: { email: 'owner@savingkc.com' },
    })
  })

  it.each([
    { email: 'other@savingkc.com', client_id: 'cursor-oauth-client' },
    { email: 'owner@savingkc.com' },
  ])('rejects OAuth claims outside the MCP identity boundary', async (claims) => {
    vi.stubEnv('CRM_MCP_TOKEN', 'configured-secret')
    vi.stubEnv('CRM_MCP_ACTOR_EMAIL', 'owner@savingkc.com')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-key')
    mocks.getClaims.mockResolvedValue({ data: { claims }, error: null })

    await expect(verifyCrmMcpToken(
      new Request('https://crm.savingkc.com/api/mcp'),
      'untrusted-oauth-token',
    )).resolves.toBeUndefined()
  })
})
