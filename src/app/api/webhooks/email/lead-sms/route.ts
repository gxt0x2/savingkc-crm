import { workflowDatabase } from '@/lib/email/workflow/connection'
import { createLeadSmsStatusHttp } from '@/lib/email/notifications/sms-status'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = createLeadSmsStatusHttp({ database: workflowDatabase })
