import { after } from 'next/server'
import { processLeadSmsAlerts } from '@/lib/email/notifications/sms-worker'
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
export async function POST(request: Request) {
  const response = await handlers.POST(request)
  const owner = process.env.EMAIL_RECEIVING_WORKER_OWNER_ID
  if (response.ok && owner) after(async () => {
    try { await processLeadSmsAlerts(workflowDatabase(), owner) }
    catch { console.error('[email-lead-sms] Worker failed; durable queue retained') }
  })
  return response
}
