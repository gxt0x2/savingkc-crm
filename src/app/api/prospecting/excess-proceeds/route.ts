import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { ExcessProceedsError, listExcessProceedsFiles } from '@/lib/server/excess-proceeds'
import type { ExcessProceedsFilter, ExcessProceedsSort } from '@/types/excess-proceeds'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SORTS = new Set<ExcessProceedsSort>(['score', 'excess_amount'])
const FILTERS = new Set<ExcessProceedsFilter>(['all', 'payout_ready', 'claim_elapsed', 'application_filed', 'handoff_ready'])

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const sort = params.get('sort')
  const filter = params.get('filter')
  if (sort && !SORTS.has(sort as ExcessProceedsSort)) {
    return prospectingJson({ error: 'Sort by score or excess amount.', code: 'invalid' }, { status: 400 })
  }
  if (filter && !FILTERS.has(filter as ExcessProceedsFilter)) {
    return prospectingJson({ error: 'That excess-proceeds filter is not recognized.', code: 'invalid' }, { status: 400 })
  }
  try {
    const files = await listExcessProceedsFiles({
      sort: sort as ExcessProceedsSort | null,
      filter: filter as ExcessProceedsFilter | null,
    })
    return prospectingJson({ files })
  } catch (error) {
    if (error instanceof ExcessProceedsError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
    console.error('[excess-proceeds] list failed', error)
    return prospectingJson({ error: 'Excess-proceeds files are unavailable.', code: 'unavailable' }, { status: 503 })
  }
}
