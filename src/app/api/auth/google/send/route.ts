export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { oauthReviewForeignLeadResponse } from '@/lib/auth/oauth-review-sandbox-session'
import { manualGmailFailureStatus, recordOutboundGmail, sendConnectedGmail } from '@/lib/gmail-send'
import { assertManualLeadEmailSend } from '@/lib/server/manual-email-consent'
import { supabase } from '@/lib/supabase-lazy'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'

// POST /api/auth/google/send { to, subject, body, leadId }
// Manual one-to-one mail uses the signed-in actor's Gmail grant. No admin
// mailbox override and no Resend fallback.
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
  if (requestedEmail && requestedEmail !== currentEmail) {
    return NextResponse.json({
      success: false,
      sent: false,
      code: 'user_email_override',
      error: 'Manual email uses the signed-in Google account.',
    }, { status: 403 })
  }

  const to = typeof json.to === 'string' ? json.to.trim() : ''
  const subject = typeof json.subject === 'string' && json.subject.trim() ? json.subject.trim() : 'Message from Saving KC'
  const body = typeof json.body === 'string' ? json.body.trim() : ''
  const leadId = typeof json.leadId === 'string' && json.leadId.trim() ? json.leadId.trim() : null
  if (!to || !body) {
    return NextResponse.json({ error: 'Recipient and message body are required' }, { status: 400 })
  }
  if (leadId) {
    const hiddenLead = await oauthReviewForeignLeadResponse(leadId, req)
    if (hiddenLead) return hiddenLead
  }

  const decision = await assertManualLeadEmailSend({ leadId, to })
  if (!decision.ok) {
    return NextResponse.json({
      success: false,
      sent: false,
      code: decision.code,
      error: decision.error,
    }, { status: decision.status })
  }

  const sent = await sendConnectedGmail({ userEmail: currentEmail, to: decision.to, subject, text: body })
  if (!sent.ok) {
    return NextResponse.json({
      success: false,
      sent: sent.code === 'gmail_result_ambiguous' ? null : false,
      error: sent.error,
      code: sent.code,
    }, { status: manualGmailFailureStatus(sent.code) })
  }

  await recordOutboundGmail({
    leadId: leadId!,
    from: sent.from,
    to: decision.to,
    subject,
    text: body,
    gmailMessageId: sent.id,
    gmailThreadId: sent.threadId,
    syncedFromUser: currentEmail,
  }).catch((error) => console.error('[google/send] lead_emails persist failed:', error))

  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'email',
    description: body,
    agent: currentEmail,
    metadata: {
      source: 'gmail_settings_send',
      direction: 'outbound',
      to: decision.to,
      subject,
      sent: true,
      provider: 'gmail',
      gmail_message_id: sent.id,
    },
  }).then(({ error }) => {
    if (error) console.error('[google/send] activity persist failed:', error)
  })
  checkAutoAdvance(leadId!, 'outbound_contact').catch((error) => console.error('[AUTO-ADVANCE] Failed:', error))

  return NextResponse.json({
    success: true,
    sent: true,
    provider: 'gmail',
    id: sent.id,
    threadId: sent.threadId,
    from: sent.from,
  })
}
