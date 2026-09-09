import { timingSafeEqual } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createClient } from '@supabase/supabase-js'
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase/env'

const MCP_SCOPES = ['crm:read', 'email']

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function configuredCrmMcpActorEmail(): string {
  const explicit = process.env.CRM_MCP_ACTOR_EMAIL?.trim().toLowerCase()
  if (explicit) return explicit

  const configuredOwner = (process.env.CRM_ASSISTANT_OWNER_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .find(Boolean)
  return configuredOwner || 'ernest@savingkc.com'
}

export function isConfiguredCrmMcpActorEmail(email: string | undefined): boolean {
  return email?.trim().toLowerCase() === configuredCrmMcpActorEmail()
}

export function isValidCrmMcpToken(suppliedToken: string | undefined): boolean {
  const configuredToken = (
    process.env.CRM_MCP_TOKEN || process.env.CRM_ASSISTANT_API_SECRET
  )?.trim()
  const supplied = suppliedToken?.trim()
  return Boolean(configuredToken && supplied && safeEqual(configuredToken, supplied))
}

export async function verifyCrmMcpToken(
  _request: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken?.trim()) return undefined

  if (isValidCrmMcpToken(bearerToken)) {
    return {
      token: bearerToken,
      clientId: 'savingkc-grok-build',
      scopes: MCP_SCOPES,
      extra: { email: configuredCrmMcpActorEmail() },
    }
  }

  try {
    const authClient = createClient(getSupabaseUrl(), getSupabasePublicKey(), {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    })
    const { data, error } = await authClient.auth.getClaims(bearerToken)
    if (error || !data?.claims) return undefined

    const email = typeof data.claims.email === 'string' ? data.claims.email.trim().toLowerCase() : ''
    const clientId = typeof data.claims.client_id === 'string' ? data.claims.client_id.trim() : ''
    if (!clientId || !isConfiguredCrmMcpActorEmail(email)) return undefined

    return {
      token: bearerToken,
      clientId,
      // Supabase returns granted scopes alongside the token rather than in the
      // access-token JWT. A verified OAuth client_id plus the exact email claim
      // establishes the one supported identity scope for this resource.
      scopes: ['email'],
      extra: { email },
    }
  } catch {
    return undefined
  }
}
