import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { parseProspectingDialerSessionSetup } from '@/lib/prospecting/campaign-contract'
import { launchProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'
import { dialerControllerFromRequest, invalidDialerControllerResponse } from '@/lib/api/dialer-controller'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const rawBody = await request.text()
  let body: unknown = {}
  try {
    if (rawBody.trim()) body = JSON.parse(rawBody) as unknown
  } catch {
    return prospectingJson({ error: 'Request body must be valid JSON', code: 'invalid_json' }, { status: 400 })
  }
  try {
    const setup = parseProspectingDialerSessionSetup(body)
    const controller = dialerControllerFromRequest(request)
    if (!controller) return invalidDialerControllerResponse()
    const row = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    const expectedGeneration = row.controllerGeneration == null ? null : Number(row.controllerGeneration)
    if (expectedGeneration !== null && (!Number.isInteger(expectedGeneration) || expectedGeneration < 0)) {
      return prospectingJson({ error: 'Dialing control changed. Refresh and try again.', code: 'invalid_controller_generation' }, { status: 400 })
    }
    const requestId = typeof row.controllerRequestId === 'string' ? row.controllerRequestId.trim() : null
    return prospectingJson(await launchProspectingDialerCampaign(actor, (await params).id, setup, {
      token: controller.token,
      label: controller.label,
      takeover: row.takeover === true,
      expectedGeneration,
      requestId,
    }), { status: 201 })
  } catch (error) {
    return prospectingError(error)
  }
}
