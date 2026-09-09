import { generateProtectedResourceMetadata } from 'mcp-handler'
import { getSupabaseUrl } from '@/lib/supabase/env'

export const CRM_MCP_RESOURCE_URL = 'https://crm.savingkc.com/api/mcp'
export const CRM_MCP_OAUTH_SCOPES = ['email']

const ALLOWED_CURSOR_REDIRECTS = new Set([
  'https://www.cursor.com/agents/mcp/oauth/callback',
  'http://localhost:8787/callback',
  'cursor://anysphere.cursor-mcp/oauth/callback',
])

export function crmMcpAuthorizationServerUrl(): string {
  return `${getSupabaseUrl().replace(/\/$/, '')}/auth/v1`
}

export function crmMcpProtectedResourceMetadata() {
  return generateProtectedResourceMetadata({
    authServerUrls: [crmMcpAuthorizationServerUrl()],
    resourceUrl: CRM_MCP_RESOURCE_URL,
    additionalMetadata: {
      scopes_supported: CRM_MCP_OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'SavingKC CRM (read-only)',
      // Grok Bot/Cursor honors this extension for OAuth providers that do not
      // yet accept the RFC 8707 resource parameter during token exchange.
      cursor_omit_resource_indicator: true,
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
