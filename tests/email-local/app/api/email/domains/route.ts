import { createDomainHttp } from '../../../../../../src/lib/email/domains/http'
import { database, subject } from '../../../../runtime'
export const dynamic = 'force-dynamic'
const handlers = createDomainHttp({ database, subject })
export async function GET(request: Request) {
  const response = await handlers.GET(request)
  if (!response.ok) return response
  return Response.json(
    { ...(await response.json()), configured: false },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
export async function POST() {
  return Response.json(
    { error: { code: 'CREDENTIAL_STORAGE_REQUIRED' } },
    { status: 503 },
  )
}
