import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { ExcessProceedsError, getExcessProceedsFile, updateExcessProceedsFile } from '@/lib/server/excess-proceeds'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function fail(error: unknown) {
  if (error instanceof ExcessProceedsError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
  console.error('[excess-proceeds] file failed', error)
  return prospectingJson({ error: 'Excess-proceeds file is unavailable.', code: 'unavailable' }, { status: 503 })
}

export async function GET(_request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const { leadId } = await params
  try {
    const file = await getExcessProceedsFile(leadId)
    if (!file) return prospectingJson({ error: 'This Deal File is not on the excess-proceeds lane.', code: 'not_found' }, { status: 404 })
    return prospectingJson({ file })
  } catch (error) {
    return fail(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const { leadId } = await params
  try {
    const body = await request.json()
    return prospectingJson({ file: await updateExcessProceedsFile(leadId, body) })
  } catch (error) {
    return fail(error)
  }
}
