import { createReceivingWorkerHttp } from '@/lib/email/inbound/worker-http'
import { pilotDatabase } from '@/lib/email/workflow/connection'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45
const run = createReceivingWorkerHttp({
  database: pilotDatabase,
  enabled: () => process.env.EMAIL_RECEIVING_WORKER_ENABLED === 'true',
  secret: () => process.env.EMAIL_RECEIVING_WORKER_SECRET,
  ownerId: () => process.env.EMAIL_RECEIVING_WORKER_OWNER_ID,
})
export const GET = run
export const POST = run
