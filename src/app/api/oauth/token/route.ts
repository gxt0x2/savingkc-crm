import { crmMcpUpstreamAuthorizationServerUrl } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_TOKEN_BODY_BYTES = 16 * 1024
const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS })
}

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return errorResponse('invalid_request', 415)
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_TOKEN_BODY_BYTES) {
    return errorResponse('invalid_request', 413)
  }

  const form = new URLSearchParams(rawBody)
  form.delete('resource')

  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const authorization = request.headers.get('authorization')
  if (authorization) headers.set('Authorization', authorization)

  try {
    const upstream = await fetch(`${crmMcpUpstreamAuthorizationServerUrl()}/oauth/token`, {
      method: 'POST',
      headers,
      body: form.toString(),
      cache: 'no-store',
      redirect: 'manual',
    })
    const body = await upstream.arrayBuffer()

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      },
    })
  } catch (error) {
    console.error('[crm-mcp-oauth] token bridge failed', {
      error: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('temporarily_unavailable', 502)
  }
}
