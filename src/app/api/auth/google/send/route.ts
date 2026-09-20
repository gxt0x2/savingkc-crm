export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'
import { recordOutboundGmail, sendConnectedGmail } from '@/lib/gmail-send'
import { supabase } from '@/lib/supabase-lazy'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'

// POST /api/auth/google/send { to, subject, body, leadId? }
export async function POST(req: NextRequest) {
  const currentEmail = await getCurrentUserEmail()
  if (!currentEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => ({})) as {
    to?: unknown
    subject?: unknown
    body?: unknown
    leadId?: unknown
    user_email?: unknown
  }
  const requestedEmail = typeof json.user_email === 'string' ? json.user_email.trim().toLowerCase() : ''
  const userEmail = requestedEmail || currentEmail
  if (requestedEmail && requestedEmail !== currentEmail && !(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const to = typeof json.to === 'string' ? json.to.trim() : ''
  const subject = typeof json.subject === 'string' && json.subject.trim() ? json.subject.trim() : 'Message from Saving KC'
  const body = typeof json.body === 'string' ? json.body.trim() : ''
  const leadId = typeof json.leadId === 'string' && json.leadId.trim() ? json.leadId.trim() : null
  if (!to || !body) {
    return NextResponse.json({ error: 'Recipient and message body are required' }, { status: 400 })
  }

  const sent = await sendConnectedGmail({ userEmail, to, subject, text: body })
  if (!sent.ok) {
    const status = sent.code === 'no_token' || sent.code === 'missing_gmail_send' || sent.code === 'reauthorization_required'
      ? 403
      : sent.code === 'invalid_recipient'
        ? 400
        : 502
    return NextResponse.json({ success: false, sent: false, error: sent.error, code: sent.code }, { status })
  }

  if (leadId) {
    await recordOutboundGmail({
      leadId,
      from: sent.from,
      to,
      subject,
      text: body,
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId,
      syncedFromUser: userEmail,
    }).catch((error) => console.error('[google/send] lead_emails persist failed:', error))

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'email',
      description: body,
      agent: userEmail,
      metadata: {
        source: 'gmail_settings_send',
        direction: 'outbound',
        to,
        subject,
        sent: true,
        provider: 'gmail',
        gmail_message_id: sent.id,
      },
    }).then(({ error }) => {
      if (error) console.error('[google/send] activity persist failed:', error)
    })
    checkAutoAdvance(leadId, 'outbound_contact').catch((error) => console.error('[AUTO-ADVANCE] Failed:', error))
  }

  return NextResponse.json({
    success: true,
    sent: true,
    provider: 'gmail',
    id: sent.id,
    threadId: sent.threadId,
    from: sent.from,
  })
}
