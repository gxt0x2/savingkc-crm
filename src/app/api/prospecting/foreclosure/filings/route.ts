import { prospectingJson } from '@/lib/api/prospecting-response'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { listFilingLane } from '@/lib/server/court-filing-lane'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const lane = new URL(request.url).searchParams.get('lane')
  if (lane !== 'divorce' && lane !== 'lien') {
    return prospectingJson({ error: 'Filing lane must be divorce or lien.', code: 'invalid_lane' }, { status: 400 })
  }
  try {
    return prospectingJson(await listFilingLane(lane))
  } catch (error) {
    if (error instanceof ForeclosureError) {
      return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[filings] unexpected failure', error)
    return prospectingJson({ error: 'Filing rows are unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
  }
}
