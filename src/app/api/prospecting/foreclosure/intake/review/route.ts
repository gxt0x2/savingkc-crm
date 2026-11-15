import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { listPendingForeclosureIntake, reviewForeclosureIntake } from '@/lib/server/foreclosure-intake'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function foreclosureError(error: unknown) {
  if (error instanceof ForeclosureError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
  console.error('[foreclosure] intake review failed', error)
  return prospectingJson({ error: 'Foreclosure intake is unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
}

export async function GET() {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    return prospectingJson({ rows: await listPendingForeclosureIntake() })
  } catch (error) {
    return foreclosureError(error)
  }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as { action?: unknown; ids?: unknown }
    const result = await reviewForeclosureIntake(actor, body)
    return prospectingJson({ ...result, rows: await listPendingForeclosureIntake() })
  } catch (error) {
    return foreclosureError(error)
  }
}
