import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { readCountyProspectAudienceSummary } from '@/lib/server/county-prospect-audiences'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  try {
    return prospectingJson(await readCountyProspectAudienceSummary())
  } catch (error) {
    console.error('[prospecting/county-audiences] read failed', error)
    return prospectingJson({ error: 'County prospect lists are unavailable' }, { status: 503 })
  }
}
