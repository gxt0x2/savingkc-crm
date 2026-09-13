import { createResendWebhookHttp } from '@/lib/email/inbound/capture'
import { emailDatabase } from '@/lib/email/workflow/connection'
export const runtime = 'nodejs'
export const maxDuration = 15
export const dynamic = 'force-dynamic'
export const POST = createResendWebhookHttp({
  database: emailDatabase,
  endpointId: () => process.env.EMAIL_RESEND_WEBHOOK_ENDPOINT_ID,
})
