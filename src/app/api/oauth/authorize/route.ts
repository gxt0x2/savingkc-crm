import { crmMcpUpstreamAuthorizationServerUrl } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function GET(request: Request) {
  const incoming = new URL(request.url)
  const upstream = new URL(`${crmMcpUpstreamAuthorizationServerUrl()}/oauth/authorize`)

  for (const [key, value] of incoming.searchParams) {
    if (key !== 'resource') upstream.searchParams.append(key, value)
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: upstream.toString(),
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}
