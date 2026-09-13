import { createResendWebhookHttp } from '@/lib/email/inbound/capture'
import { pilotDatabase } from '@/lib/email/workflow/connection'
export const runtime = 'nodejs'
export const maxDuration = 15
export const dynamic = 'force-dynamic'
export const POST = createResendWebhookHttp({
  database: pilotDatabase,
  endpointId: () => process.env.EMAIL_RESEND_WEBHOOK_ENDPOINT_ID,
})
