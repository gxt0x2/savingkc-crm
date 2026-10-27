import { Resend } from 'resend'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'

export type TransactionalEmailStatus = 'sent' | 'skipped' | 'failed' | 'not_configured'

export type TransactionalEmailResult = {
  success: boolean
  status: TransactionalEmailStatus
  id: string | null
  error: string | null
}

/**
 * CRM transactional mail, the same Resend sender appointment email uses.
 * This is not the savingkc.com marketing dispatch path.
 */
export async function sendCrmTransactionalEmail(input: {
  to: string
  subject: string
  text: string
  idempotencyKey?: string
}): Promise<TransactionalEmailResult> {
  const to = input.to.trim()
  const subject = input.subject.replace(/[\r\n]+/g, ' ').trim()
  const text = input.text.trim()
  if (!to || !to.includes('@') || !subject || !text) {
    return { success: false, status: 'failed', id: null, error: 'Transactional email is missing a recipient, subject, or body' }
  }

  if (externalSideEffectsDisabled()) {
    return { success: true, status: 'skipped', id: null, error: null }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim() || ''
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || ''
  if (!apiKey || !fromEmail) {
    return {
      success: false,
      status: 'not_configured',
      id: null,
      error: 'Transactional email sender is not configured',
    }
  }

  try {
    const result = await new Resend(apiKey).emails.send({
      from: `Saving KC CRM <${fromEmail}>`,
      to: [to],
      subject,
      text,
    }, input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined)
    if (result.error || !result.data?.id) {
      return {
        success: false,
        status: 'failed',
        id: null,
        error: result.error?.message || 'Transactional email was not accepted',
      }
    }
    return { success: true, status: 'sent', id: result.data.id, error: null }
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      id: null,
      error: error instanceof Error ? error.message : 'Transactional email failed',
    }
  }
}
