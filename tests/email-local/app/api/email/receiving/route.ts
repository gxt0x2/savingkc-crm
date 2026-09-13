import { createReceivingHttp } from '../../../../../../src/lib/email/inbound/operations'
import { database, subject } from '../../../../runtime'
export const dynamic = 'force-dynamic'
const handlers = createReceivingHttp({ database, subject })
export const GET = handlers.GET
// A disposable demo never uses live provider credentials or calls a receiving API.
export async function POST() {
  return Response.json(
    { error: { code: 'LOCAL_PROVIDER_DISABLED' } },
    { status: 503 },
  )
}
