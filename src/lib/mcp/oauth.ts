import { generateProtectedResourceMetadata } from 'mcp-handler'
import { getSupabaseUrl } from '@/lib/supabase/env'

export const CRM_MCP_RESOURCE_URL = 'https://crm.savingkc.com/api/mcp'
export const CRM_MCP_OAUTH_SCOPES = ['email']
export const CRM_MCP_AUTHORIZATION_SERVER_URL = 'https://crm.savingkc.com'

const ALLOWED_CURSOR_REDIRECTS = new Set([
  'https://www.cursor.com/agents/mcp/oauth/callback',
  'http://localhost:8787/callback',
  'cursor://anysphere.cursor-mcp/oauth/callback',
])

export function crmMcpAuthorizationServerUrl(): string {
  return CRM_MCP_AUTHORIZATION_SERVER_URL
}

export function crmMcpUpstreamAuthorizationServerUrl(): string {
  return `${getSupabaseUrl().replace(/\/$/, '')}/auth/v1`
}

export function crmMcpAuthorizationServerMetadata() {
  return {
    issuer: CRM_MCP_AUTHORIZATION_SERVER_URL,
    authorization_endpoint: `${CRM_MCP_AUTHORIZATION_SERVER_URL}/api/oauth/authorize`,
    token_endpoint: `${CRM_MCP_AUTHORIZATION_SERVER_URL}/api/oauth/token`,
    registration_endpoint: `${CRM_MCP_AUTHORIZATION_SERVER_URL}/api/oauth/register`,
    scopes_supported: [...CRM_MCP_OAUTH_SCOPES, 'offline_access'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256', 'plain'],
  }
}

export function crmMcpProtectedResourceMetadata() {
  return generateProtectedResourceMetadata({
    authServerUrls: [crmMcpAuthorizationServerUrl()],
    resourceUrl: CRM_MCP_RESOURCE_URL,
    additionalMetadata: {
      scopes_supported: CRM_MCP_OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'SavingKC CRM (read-only)',
    },
  })
}

export function isAllowedCrmMcpRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return false
    return ALLOWED_CURSOR_REDIRECTS.has(url.toString())
  } catch {
    return false
  }
}
