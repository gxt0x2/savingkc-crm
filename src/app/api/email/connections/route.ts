import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { pilotDatabase } from '@/lib/email/workflow/connection'
import { createConnectionHttp } from '@/lib/email/connections/http'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
const handlers = createConnectionHttp({
  subject: async (request) =>
    (await resolveAuthenticatedActor(request))?.subject ?? null,
  database: pilotDatabase,
})
export const GET = handlers.GET
export const POST = handlers.POST

export const DELETE = handlers.DELETE
