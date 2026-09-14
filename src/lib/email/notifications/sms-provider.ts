import 'server-only'
import { safeSendSMS } from '@/lib/safe-communications'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { MAIN_SAVINGKC_CALLER_ID } from '@/lib/telephony/agent-identity'

export function leadSmsEnabled() {
  return process.env.EMAIL_LEAD_SMS_ENABLED === 'true' &&
    process.env.EMAIL_WORKFLOW_MODE === 'hosted' && !externalSideEffectsDisabled()
}
export async function sendLeadAlertSms(input: { id: string; phone: string; body: string }) {
  if (!leadSmsEnabled()) throw new Error('SMS_ALERTS_DISABLED')
  return safeSendSMS({
    to: input.phone, from: MAIN_SAVINGKC_CALLER_ID, body: input.body,
    statusCallback: `https://crm.savingkc.com/api/webhooks/email/lead-sms?id=${input.id}`,
    // A transport timeout is an unknown result, never permission to resend.
    signal: AbortSignal.timeout(35_000),
  })
}
