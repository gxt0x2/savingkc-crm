import 'server-only'

import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { safeSendSMS, type SMSResult } from '@/lib/safe-communications'
import { MAIN_SAVINGKC_CALLER_ID } from '@/lib/telephony/agent-identity'

const DEFAULT_ERNEST_PHONE = '+18162262552'
const CRM_ORIGIN = 'https://crm.savingkc.com'

export type OperationalSmsAlertResult = {
  attempted: boolean
  recipient: string | null
  result: SMSResult | null
}

function ernestPhone(): string {
  return normalizePhoneToE164(process.env.ERNEST_PHONE) || DEFAULT_ERNEST_PHONE
}

function crmUrl(path: string): string {
  return `${CRM_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

async function sendOperationalSmsAlert(input: {
  event: 'andon_raised' | 'call_review_submitted' | 'mojo_ingestion_failure'
  recipient: string
  body: string
  referenceId: string
}): Promise<OperationalSmsAlertResult> {
  const result = await safeSendSMS({
    to: input.recipient,
    from: MAIN_SAVINGKC_CALLER_ID,
    body: input.body,
  })

  const log = {
    level: result.success ? 'info' : 'error',
    message: 'operational_sms_alert',
    event: input.event,
    referenceId: input.referenceId,
    success: result.success,
    sid: result.sid ?? null,
    error: result.error ?? null,
  }
  if (result.success) console.log(JSON.stringify(log))
  else console.error(JSON.stringify(log))

  return { attempted: true, recipient: input.recipient, result }
}

export async function sendMojoIngestionFailureSmsAlert(input: {
  incidentId: string
  message: string
  source: string
}): Promise<OperationalSmsAlertResult> {
  return sendOperationalSmsAlert({
    event: 'mojo_ingestion_failure',
    recipient: ernestPhone(),
    referenceId: input.incidentId,
    body: `Mojo ingestion failure (${input.source}): ${input.message}. Casey's current Mojo totals are withheld until recovery. Open: ${crmUrl('/settings/system-health')}`,
  })
}

export async function sendAndonRaisedSmsAlert(input: {
  issueId: string
  issueKind: string
  department: string
  category: string
  priority: string
  raisedBy: string
}): Promise<OperationalSmsAlertResult> {
  const label = input.issueKind === 'system' ? 'System issue' : 'Andon'
  return sendOperationalSmsAlert({
    event: 'andon_raised',
    recipient: ernestPhone(),
    referenceId: input.issueId,
    body: `${label}: ${input.department} / ${input.category} (${input.priority}), raised by ${input.raisedBy}. Open: ${crmUrl('/reports/andon')}`,
  })
}

export async function sendCallReviewSubmittedSmsAlert(input: {
  activityId: string
  leadId: string | null
  frameworkLabel: string
  submittedBy: string
  assignedReviewer: string
}): Promise<OperationalSmsAlertResult> {
  if (input.assignedReviewer.trim().toLowerCase() !== 'ernest@savingkc.com') {
    console.log(JSON.stringify({
      level: 'info',
      message: 'operational_sms_alert_skipped',
      event: 'call_review_submitted',
      referenceId: input.activityId,
      assignedReviewer: input.assignedReviewer,
      reason: 'reviewer_sms_not_configured',
    }))
    return { attempted: false, recipient: null, result: null }
  }

  const path = input.leadId ? `/leads/${encodeURIComponent(input.leadId)}` : '/marketing/call-recordings'
  return sendOperationalSmsAlert({
    event: 'call_review_submitted',
    recipient: ernestPhone(),
    referenceId: input.activityId,
    body: `Call review submitted by ${input.submittedBy} — ${input.frameworkLabel}. Open: ${crmUrl(path)}`,
  })
}
