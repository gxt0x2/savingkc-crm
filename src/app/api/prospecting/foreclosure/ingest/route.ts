import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import {
  ForeclosureError,
  listForeclosureIngestControls,
  setForeclosureIngestControl,
} from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function foreclosureError(error: unknown) {
  if (error instanceof ForeclosureError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
  console.error('[foreclosure] unexpected failure', error)
  return prospectingJson({ error: 'Foreclosure records are unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
}

export async function GET() {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    return prospectingJson({ controls: await listForeclosureIngestControls() })
  } catch (error) {
    return foreclosureError(error)
  }
}

export async function PATCH(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as Record<string, unknown>
    const control = await setForeclosureIngestControl(actor, body)
    return prospectingJson({ control, controls: await listForeclosureIngestControls() })
  } catch (error) {
    return foreclosureError(error)
  }
}
