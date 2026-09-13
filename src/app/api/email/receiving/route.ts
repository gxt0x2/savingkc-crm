import { createReceivingHttp } from '@/lib/email/inbound/operations'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { workflowDatabase } from '@/lib/email/workflow/connection'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
const handlers = createReceivingHttp({
  database: workflowDatabase,
  subject: async (request) =>
    (await resolveAuthenticatedActor(request))?.subject ?? null,
})
export const GET = handlers.GET
export const POST = handlers.POST
