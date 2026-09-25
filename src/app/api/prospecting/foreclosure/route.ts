import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { FORECLOSURE_STATUSES } from '@/lib/prospecting/foreclosure'
import {
  ForeclosureError,
  createForeclosureProspect,
  listForeclosureProspects,
} from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function foreclosureError(error: unknown) {
  if (error instanceof ForeclosureError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
  console.error('[foreclosure] unexpected failure', error)
  return prospectingJson({ error: 'Foreclosure records are unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
}

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const params = new URL(request.url).searchParams
    const status = params.get('status')
    if (status && !(FORECLOSURE_STATUSES as readonly string[]).includes(status)) {
      return prospectingJson({ error: 'That foreclosure status is not recognized.', code: 'invalid_status' }, { status: 400 })
    }
    const prospects = await listForeclosureProspects({
      county: params.get('county'),
      status,
      dialReady: params.get('dialReady') === '1',
    })
    return prospectingJson({ prospects })
  } catch (error) {
    return foreclosureError(error)
  }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as Record<string, unknown>
    return prospectingJson({ prospect: await createForeclosureProspect(actor, body) }, { status: 201 })
  } catch (error) {
    return foreclosureError(error)
  }
}
