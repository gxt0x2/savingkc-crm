import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { workflowDatabase } from '@/lib/email/workflow/connection'
import { createWorkflowHttp } from '@/lib/email/workflow/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
const handlers = createWorkflowHttp({
  subject: async (request) =>
    (await resolveAuthenticatedActor(request))?.subject ?? null,
  database: workflowDatabase,
})
export const GET = handlers.GET
export const POST = handlers.POST
