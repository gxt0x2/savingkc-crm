export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logTcEvent } from '@/lib/tc'
import { unresolvedCommunicationTemplateFields } from '@/lib/operating-model/communication-template-catalog'

const sendSchema = z.object({
  confirm_send: z.literal(true),
  actor: z.string().min(1).optional(),
  from_email: z.string().email().optional(),
  from_phone: z.string().min(1).optional(),
})

const DEFAULT_TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

const draftSelect = `*,
template:template_id(id, slug, title, template_type, audience, subject, body),
file:tc_file_id(id, lead_id, status, file_number, emd_due_at, closing_scheduled_at, assignment_fee,
  lead:lead_id(id, full_name, phone, email, property_address, city, state, zip, offer_amount),
  offer:buyer_offer_id(id, offer_amount, buyer:buyer_id(id, name, company, email, phone)),
  title_company:title_company_id(id, name, office_phone, office_email),
  title_contact:title_contact_id(id, name, role, email, phone))`

interface SendDraftRow {
  id: string
  tc_file_id: string
  lead_id: string
  channel: 'email' | 'document' | 'sms'
  recipient_role: 'buyer' | 'seller' | 'title' | 'internal'
  recipient_email: string | null
  recipient_phone: string | null
  subject: string | null
  draft_body: string
  edited_body: string | null
  approved_body: string | null
  status: 'pending' | 'approved' | 'rejected' | 'sending' | 'sent' | 'superseded'
  sent_at: string | null
}

interface DeliveryResult {
  provider: string
  messageId: string | null
}

class DraftSendError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

function isTestMode() {
  return process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'development'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function htmlFromText(body: string) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827">${escapeHtml(body).replace(/\n/g, '<br />')}</div>`
}

function approvedBody(draft: SendDraftRow) {
  return (draft.approved_body || draft.edited_body || draft.draft_body).trim()
}

async function sendEmailDraft(draft: SendDraftRow, body: string, fromEmail?: string): Promise<DeliveryResult> {
  if (!draft.recipient_email) throw new DraftSendError('Draft has no recipient email', 400)

  const subject = draft.subject?.trim() || 'Message from Saving KC'
  if (isTestMode()) {
    console.log('[tc/drafts/send] TEST_MODE email not sent', {
      draft_id: draft.id,
      to: draft.recipient_email,
      subject,
    })
    return { provider: 'resend:test', messageId: `TEST_EMAIL_${Date.now()}` }
  }

  if (!process.env.RESEND_API_KEY) throw new DraftSendError('RESEND_API_KEY is not configured', 500)

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const sender = fromEmail || process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'
  const response = await resend.emails.send({
    from: `Saving KC <${sender}>`,
    to: [draft.recipient_email],
    subject,
    text: body,
    html: htmlFromText(body),
  })

  if (response.error) {
    throw new DraftSendError(response.error.message || 'Email send failed', 502)
  }

  return { provider: 'resend', messageId: response.data?.id ?? null }
}

async function sendSmsDraft(draft: SendDraftRow, body: string, fromPhone?: string): Promise<DeliveryResult> {
  if (!draft.recipient_phone) throw new DraftSendError('Draft has no recipient phone', 400)

  const [{ isOptedOut }, { isDuplicateSms, logSmsSend }, { safeSendSMS }] = await Promise.all([
    import('@/lib/sms-opt-out'),
    import('@/lib/sms-dedup'),
    import('@/lib/safe-communications'),
  ])

  if (await isOptedOut(draft.recipient_phone)) {
    throw new DraftSendError('This number has opted out of SMS messages', 400)
  }
  if (await isDuplicateSms(draft.recipient_phone, body)) {
    throw new DraftSendError('Duplicate SMS - same message sent to this number within 24 hours', 409)
  }

  const from = fromPhone || DEFAULT_TWILIO_PHONE
  const result = await safeSendSMS({
    body,
    from,
    to: draft.recipient_phone,
  })

  if (!result.success) {
    throw new DraftSendError(result.error || 'SMS send failed', 502)
  }

  await logSmsSend(draft.recipient_phone, body, from, draft.lead_id)
  return { provider: 'twilio', messageId: result.sid ?? null }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = 'system'
  const db = supabaseAdmin()

  try {
    const parsed = sendSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const input = parsed.data
    const sendActor = input.actor ?? actor

    const { data: current, error: currentError } = await db
      .from('tc_drafts')
      .select(draftSelect)
      .eq('id', id)
      .maybeSingle<SendDraftRow>()

    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
    if (!current) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (current.status !== 'approved') {
      return NextResponse.json({ error: 'Only approved drafts can be sent' }, { status: 409 })
    }
    if (current.sent_at) {
      return NextResponse.json({ error: 'Draft has already been sent' }, { status: 409 })
    }

    const body = approvedBody(current)
    if (!body) return NextResponse.json({ error: 'Approved draft body is empty' }, { status: 400 })
    const unresolvedFields = unresolvedCommunicationTemplateFields(current.subject, body)
    if (unresolvedFields.length > 0) {
      return NextResponse.json({
        error: 'Approved draft still contains unresolved template fields',
        unresolved_fields: unresolvedFields,
      }, { status: 409 })
    }
    if (current.channel === 'document') {
      return NextResponse.json({ error: 'Document draft sending is not supported yet' }, { status: 400 })
    }

    const { data: locked, error: lockError } = await db
      .from('tc_drafts')
      .update({
        status: 'sending',
        delivery_started_at: new Date().toISOString(),
        delivery_error: null,
      })
      .eq('id', id)
      .eq('status', 'approved')
      .is('sent_at', null)
      .select('id')
      .maybeSingle()

    if (lockError) return NextResponse.json({ error: lockError.message }, { status: 500 })
    if (!locked) {
      return NextResponse.json({ error: 'Draft is no longer approved or is already sending' }, { status: 409 })
    }

    let delivery: DeliveryResult
    try {
      delivery = current.channel === 'sms'
        ? await sendSmsDraft(current, body, input.from_phone)
        : await sendEmailDraft(current, body, input.from_email)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Draft send failed'
      await db
        .from('tc_drafts')
        .update({
          status: 'approved',
          delivery_error: message,
        })
        .eq('id', id)
      await logTcEvent(db, current.tc_file_id, 'draft_send_failed', {
        draft_id: id,
        channel: current.channel,
        recipient_role: current.recipient_role,
        error: message,
      }, sendActor)
      const status = err instanceof DraftSendError ? err.status : 500
      return NextResponse.json({ error: message }, { status })
    }

    const { data: draft, error: updateError } = await db
      .from('tc_drafts')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_by: sendActor,
        delivery_provider: delivery.provider,
        delivery_message_id: delivery.messageId,
        delivery_error: null,
      })
      .eq('id', id)
      .select(draftSelect)
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    await logTcEvent(db, current.tc_file_id, 'draft_sent', {
      draft_id: id,
      channel: current.channel,
      recipient_role: current.recipient_role,
      provider: delivery.provider,
      message_id: delivery.messageId,
    }, sendActor)

    return NextResponse.json({ draft, delivery })
  } catch (err) {
    console.error('[tc/drafts/:id/send POST] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
