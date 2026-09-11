import { crmMcpUpstreamAuthorizationServerUrl } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_REGISTRATION_BODY_BYTES = 64 * 1024
const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS })
}

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return errorResponse('invalid_client_metadata', 415)
  }

  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAX_REGISTRATION_BODY_BYTES) {
    return errorResponse('invalid_client_metadata', 413)
  }

  try {
    const upstream = await fetch(`${crmMcpUpstreamAuthorizationServerUrl()}/oauth/clients/register`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body,
      cache: 'no-store',
      redirect: 'manual',
    })
    const responseBody = await upstream.arrayBuffer()

    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      },
    })
  } catch (error) {
    console.error('[crm-mcp-oauth] registration bridge failed', {
      error: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('temporarily_unavailable', 502)
  }
}
