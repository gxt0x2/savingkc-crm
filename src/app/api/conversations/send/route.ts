import { NextResponse } from 'next/server'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { supabase } from '@/lib/supabase-lazy'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'

export async function POST(req: Request) {
  try {
    const authenticatedActor = await resolveAuthenticatedActor()
    if (!authenticatedActor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const json = await req.json()
    const {
      leadId,
      phone,
      body,
      mode,
      fromPhone,
      resolveSenderFromConversation,
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
    const actor = authenticatedActor.name

    if (mode === 'sms') {
      const result = await sendLeadSms({
        leadId,
        phone,
        body,
        fromPhone: resolveSenderFromConversation === true ? undefined : fromPhone,
        agent: actor,
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

      return NextResponse.json({
        success: true,
        sent: true,
        persisted: result.persisted,
        deliveryState: result.deliveryState,
        warning: result.warning,
        sid: result.sid,
        from: result.from,
      })
    }

    if (mode === 'email') {
      const emailSubject = subject || 'Message from Saving KC'
      if (externalSideEffectsDisabled()) {
        return NextResponse.json(
          { success: false, sent: false, error: 'Email delivery is disabled in this environment' },
          { status: 503 },
        )
      }
      if (!process.env.RESEND_API_KEY) {
        return NextResponse.json(
          { success: false, sent: false, error: 'Email delivery is not configured' },
          { status: 503 },
        )
      }

      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'
      const delivery = await resend.emails.send({
        from: `Saving KC <${fromEmail}>`,
        to: [to],
        subject: emailSubject,
        text: body.trim(),
      })

      if (delivery.error || !delivery.data?.id) {
        return NextResponse.json(
          { success: false, sent: false, error: delivery.error?.message || 'Email provider did not accept the message' },
          { status: 502 },
        )
      }

      let activityPersistenceError: unknown = null
      try {
        const { error } = await supabase.from('lead_activities').insert({
          lead_id: leadId || null,
          activity_type: 'email',
          description: body.trim(),
          agent: actor,
          metadata: {
            ...(activitySource ? { source: activitySource } : {}),
            ...prospectMetadata,
            direction: 'outbound',
            to,
            subject: emailSubject,
            sent: true,
          },
        })
        activityPersistenceError = error
      } catch (error) {
        activityPersistenceError = error
      }

      if (leadId) {
        checkAutoAdvance(leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))
        onCommunicationEvent(leadId, { type: 'email', content: body.trim() }).catch(err => console.error('[MANIFEST-SYNC] Failed:', err))
      }

      if (activityPersistenceError) {
        console.error('[CONVERSATIONS] Email delivered but activity persistence failed:', activityPersistenceError)
        return NextResponse.json({
          success: true,
          sent: true,
          persisted: false,
          deliveryState: 'delivered_not_persisted',
          warning: 'Email delivered, but CRM history could not be saved. Do not resend this email.',
          id: delivery.data.id,
        })
      }

      return NextResponse.json({
        success: true,
        sent: true,
        persisted: true,
        deliveryState: 'delivered_and_persisted',
        id: delivery.data.id,
      })
    }

    if (mode === 'call') {
      // Log call note
      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'call',
        description: body.trim(),
        agent: actor,
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
    return NextResponse.json({ error: 'Conversation could not be sent' }, { status: 500 })
  }
}
