import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyCrmMcpToken } from '@/lib/mcp/auth'
import { registerCrmMcpTools } from '@/lib/mcp/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const handler = createMcpHandler(
  registerCrmMcpTools,
  { serverInfo: { name: 'savingkc-crm', version: '1.0.0' } },
  {
    basePath: '/api',
    disableSse: true,
    maxDuration,
    verboseLogs: false,
  },
)

const authenticatedHandler = withMcpAuth(handler, verifyCrmMcpToken, {
  required: true,
  requiredScopes: ['crm:read'],
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
})

export { authenticatedHandler as GET, authenticatedHandler as POST }
