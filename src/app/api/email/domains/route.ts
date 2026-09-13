import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { pilotDatabase } from '@/lib/email/workflow/connection'
import { createDomainHttp } from '@/lib/email/domains/http'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
const handlers = createDomainHttp({
  subject: async (request) =>
    (await resolveAuthenticatedActor(request))?.subject ?? null,
  database: pilotDatabase,
})
export const GET = handlers.GET
export const POST = handlers.POST
