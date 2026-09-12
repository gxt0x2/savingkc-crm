import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { pilotDatabase } from '@/lib/email/workflow/connection'
import { createWorkflowHttp } from '@/lib/email/workflow/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const handlers = createWorkflowHttp({
  subject: async (request) =>
    (await resolveAuthenticatedActor(request))?.subject ?? null,
  database: pilotDatabase,
})
export const GET = handlers.GET
export const POST = handlers.POST
