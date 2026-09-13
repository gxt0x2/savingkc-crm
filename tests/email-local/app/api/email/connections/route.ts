import { createConnectionHttp } from '../../../../../../src/lib/email/connections/http'
import { database, now, subject } from '../../../../runtime'
export const dynamic = 'force-dynamic'
const handlers = createConnectionHttp({ database, now, subject })
export async function GET(request: Request) {
  const response = await handlers.GET(request)
  if (!response.ok) return response
  return Response.json(
    { ...(await response.json()), configured: false },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
// A disposable local workspace must never receive real provider keys.
export async function POST() {
  return Response.json(
    { error: { code: 'CREDENTIAL_STORAGE_REQUIRED' } },
    { status: 503 },
  )
}

export const DELETE = POST
