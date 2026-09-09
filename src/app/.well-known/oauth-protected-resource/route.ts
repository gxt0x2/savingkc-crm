import { metadataCorsOptionsRequestHandler } from 'mcp-handler'
import { crmMcpProtectedResourceMetadata } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function GET() {
  return Response.json(crmMcpProtectedResourceMetadata(), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
