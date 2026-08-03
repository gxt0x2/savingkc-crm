import { NextResponse } from 'next/server'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { supabase } from '@/lib/supabase-lazy'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const {
      leadId,
      phone,
      body,
      mode,
      fromPhone,
      agent,
      to,
      subject,
      source,
      prospectPhoneId,
      heirName,
      heirRelation,
      prospectOwnerName,
    } = json
    const activitySource = typeof source === 'string' && source.trim() ? source.trim() : undefined
    const prospectMetadata = {
      ...(typeof prospectPhoneId === 'string' && prospectPhoneId.trim() ? { prospect_phone_id: prospectPhoneId.trim() } : {}),
      ...(typeof heirName === 'string' && heirName.trim() ? { heir_name: heirName.trim() } : {}),
      ...(typeof heirRelation === 'string' && heirRelation.trim() ? { heir_relation: heirRelation.trim() } : {}),
      ...(typeof prospectOwnerName === 'string' && prospectOwnerName.trim() ? { prospect_owner_name: prospectOwnerName.trim() } : {}),
    }

    if (mode === 'email') {
      if (!to || !body?.trim()) {
        return NextResponse.json({ error: 'Missing email recipient or body' }, { status: 400 })
      }
    } else if (!phone || !body?.trim()) {
      return NextResponse.json({ error: 'Missing phone or message body' }, { status: 400 })
    }

    if (mode === 'sms') {
      const result = await sendLeadSms({
        leadId,
        phone,
        body,
        fromPhone,
        agent,
        source: activitySource,
        metadata: Object.keys(prospectMetadata).length > 0 ? prospectMetadata : undefined,
      })

      if (result.status === 'failed') {
        return NextResponse.json({ error: result.error }, { status: 502 })
      }
      if (result.status === 'skipped') {
        return result.reason === 'opted_out'
          ? NextResponse.json({ error: 'This number has opted out of SMS messages' }, { status: 400 })
          : NextResponse.json({ error: 'Duplicate SMS — same message sent to this number within 24 hours' }, { status: 409 })
      }

      return NextResponse.json({ success: true, sid: result.sid, from: result.from })
    }

    if (mode === 'email') {
      const emailSubject = subject || 'Message from Saving KC'
      let sent = false

      if (!externalSideEffectsDisabled() && process.env.RESEND_API_KEY) {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'
        await resend.emails.send({
          from: `Saving KC <${fromEmail}>`,
          to: [to],
          subject: emailSubject,
          text: body.trim(),
        })
        sent = true
      }

      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'email',
        description: body.trim(),
        agent: agent || 'System',
        metadata: {
          ...(activitySource ? { source: activitySource } : {}),
          ...prospectMetadata,
          direction: 'outbound',
          to,
          subject: emailSubject,
          sent,
        },
      })

      if (leadId) {
        checkAutoAdvance(leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))
        onCommunicationEvent(leadId, { type: 'email', content: body.trim() }).catch(err => console.error('[MANIFEST-SYNC] Failed:', err))
      }

      return NextResponse.json({ success: true, sent })
    }

    if (mode === 'call') {
      // Log call note
      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'call',
        description: body.trim(),
        agent: agent || 'System',
        metadata: {
          ...(activitySource ? { source: activitySource } : {}),
          ...prospectMetadata,
          direction: 'outbound',
          to: phone,
          note: true,
        },
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 })
  } catch (err) {
    console.error('conversations/send error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
