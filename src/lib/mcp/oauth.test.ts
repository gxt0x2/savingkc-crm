import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CRM_MCP_RESOURCE_URL,
  crmMcpAuthorizationServerMetadata,
  crmMcpAuthorizationServerUrl,
  crmMcpUpstreamAuthorizationServerUrl,
  crmMcpProtectedResourceMetadata,
  isAllowedCrmMcpRedirectUri,
} from './oauth'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CRM MCP OAuth metadata', () => {
  it('advertises the production MCP resource and Supabase authorization server', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co/')

    expect(crmMcpAuthorizationServerUrl()).toBe('https://crm.savingkc.com')
    expect(crmMcpUpstreamAuthorizationServerUrl()).toBe('https://project.supabase.co/auth/v1')
    expect(crmMcpProtectedResourceMetadata()).toMatchObject({
      resource: CRM_MCP_RESOURCE_URL,
      authorization_servers: ['https://crm.savingkc.com'],
      scopes_supported: ['email'],
      bearer_methods_supported: ['header'],
    })
  })

  it('advertises the CRM compatibility bridge as the OAuth server', () => {
    expect(crmMcpAuthorizationServerMetadata()).toMatchObject({
      issuer: 'https://crm.savingkc.com',
      authorization_endpoint: 'https://crm.savingkc.com/api/oauth/authorize',
      token_endpoint: 'https://crm.savingkc.com/api/oauth/token',
      registration_endpoint: 'https://crm.savingkc.com/api/oauth/register',
      scopes_supported: ['email', 'offline_access'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'],
    })
  })

  it.each([
    'https://www.cursor.com/agents/mcp/oauth/callback',
    'http://localhost:8787/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
  ])('allows the documented Cursor callback %s', (redirectUri) => {
    expect(isAllowedCrmMcpRedirectUri(redirectUri)).toBe(true)
  })

  it.each([
    'https://cursor.com/agents/mcp/oauth/callback',
    'https://attacker.example/callback',
    'https://www.cursor.com/agents/mcp/oauth/callback?next=https://attacker.example',
    'not-a-url',
  ])('rejects an unapproved callback %s', (redirectUri) => {
    expect(isAllowedCrmMcpRedirectUri(redirectUri)).toBe(false)
  })
})
