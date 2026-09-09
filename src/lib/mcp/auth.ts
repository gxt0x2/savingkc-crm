import { timingSafeEqual } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

const MCP_SCOPES = ['crm:read']

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

export function isValidCrmMcpToken(suppliedToken: string | undefined): boolean {
  const configuredToken = process.env.CRM_MCP_TOKEN?.trim()
  const supplied = suppliedToken?.trim()
  return Boolean(configuredToken && supplied && safeEqual(configuredToken, supplied))
}

export function verifyCrmMcpToken(_request: Request, bearerToken?: string): AuthInfo | undefined {
  if (!isValidCrmMcpToken(bearerToken)) return undefined

  return {
    token: bearerToken!,
    clientId: 'savingkc-grok-build',
    scopes: MCP_SCOPES,
    extra: { email: configuredCrmMcpActorEmail() },
  }
}
