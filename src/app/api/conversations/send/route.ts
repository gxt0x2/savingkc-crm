import { NextResponse } from 'next/server'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { supabase } from '@/lib/supabase-lazy'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  assertDialerMutationControl,
  dialerMutationControlErrorResponse,
} from '@/lib/api/dialer-mutation-control'
import {
  dialerProviderDeadlineExceeded,
  dialerProviderSignal,
} from '@/lib/server/dialer-provider-boundary'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

const DIALER_OPERATION_UNCERTAIN_HEADERS = {
  'X-Dialer-Operation-Uncertain': 'true',
}

async function controlledSmsRecipientMatches(input: {
  leadId: unknown
  phone: unknown
  prospectPhoneId: unknown
}): Promise<boolean> {
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : ''
  const phone = normalizePhoneToE164(typeof input.phone === 'string' ? input.phone : '')
  const prospectPhoneId = typeof input.prospectPhoneId === 'string' ? input.prospectPhoneId.trim() : ''
  if (!leadId || !phone) return false

  if (prospectPhoneId) {
    const { data, error } = await supabase
      .from('prospect_phones')
      .select('phone, prospects(lead_id)')
      .eq('id', prospectPhoneId)
      .maybeSingle<{
        phone: string | null
        prospects: { lead_id: string | null } | null
      }>()
    if (error) throw error
    return data?.prospects?.lead_id === leadId && normalizePhoneToE164(data.phone) === phone
  }

  const { data, error } = await supabase
    .from('leads')
    .select('phone')
    .eq('id', leadId)
    .maybeSingle<{ phone: string | null }>()
  if (error) throw error
  return normalizePhoneToE164(data?.phone) === phone
}

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
      dialerSessionId,
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

    let controlledSession = null
    try {
      controlledSession = await assertDialerMutationControl({
        request: req,
        actor: authenticatedActor,
        sessionId: dialerSessionId,
        subject: { leadId },
        required: activitySource === 'heir_dialer',
        protectMatchingOpenSession: true,
      })
    } catch (error) {
      const controlResponse = dialerMutationControlErrorResponse(error)
      if (controlResponse) return controlResponse
      throw error
    }
    if (controlledSession && mode === 'sms' && !await controlledSmsRecipientMatches({
      leadId,
      phone,
      prospectPhoneId,
    })) {
      return NextResponse.json({
        error: 'The selected phone no longer belongs to the active dialing seller.',
        code: 'recipient_context_mismatch',
      }, { status: 409 })
    }
    const actor = authenticatedActor.name
    const providerSignal = dialerProviderSignal(req, controlledSession)
    const reassertPersistenceControl = controlledSession
      ? async () => {
          await assertDialerMutationControl({
            request: req,
            actor: authenticatedActor,
            sessionId: controlledSession.id,
            subject: { leadId },
            required: true,
          })
        }
      : undefined

    if (mode === 'sms') {
      const result = await sendLeadSms({
        leadId,
        phone,
        body,
        fromPhone: resolveSenderFromConversation === true ? undefined : fromPhone,
        agent: actor,
        source: activitySource,
        metadata: Object.keys(prospectMetadata).length > 0 ? prospectMetadata : undefined,
        signal: providerSignal,
        beforePersistence: reassertPersistenceControl,
      })

      if (result.status === 'failed') {
        if (result.deliveryState === 'delivery_unknown') {
          return NextResponse.json({
            success: false,
            sent: null,
            persisted: false,
            code: 'delivery_unknown',
            deliveryState: result.deliveryState,
            error: result.error,
          }, {
            status: 504,
            headers: DIALER_OPERATION_UNCERTAIN_HEADERS,
          })
        }
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
      type ResendRequestOptionsWithSignal = NonNullable<Parameters<typeof resend.emails.send>[1]> & {
        signal: AbortSignal
      }
      const resendRequestOptions: ResendRequestOptionsWithSignal | undefined = providerSignal
        ? {
            signal: providerSignal,
            ...(req.headers.get('x-dialer-operation')?.trim()
              ? { idempotencyKey: req.headers.get('x-dialer-operation')!.trim() }
              : {}),
          }
        : undefined
      let delivery: Awaited<ReturnType<typeof resend.emails.send>>
      try {
        delivery = await resend.emails.send({
          from: `Saving KC <${fromEmail}>`,
          to: [to],
          subject: emailSubject,
          text: body.trim(),
        }, resendRequestOptions)
      } catch (error) {
        if (providerSignal) {
          const detail = dialerProviderDeadlineExceeded(providerSignal)
            ? 'Email provider timed out after submission; delivery could not be confirmed. Do not resend this email.'
            : 'Email provider connection ended after submission; delivery could not be confirmed. Do not resend this email.'
          console.error('[CONVERSATIONS] Protected email delivery is unknown:', error)
          return NextResponse.json({
            success: false,
            sent: null,
            persisted: false,
            code: 'delivery_unknown',
            deliveryState: 'delivery_unknown',
            error: detail,
          }, {
            status: 504,
            headers: DIALER_OPERATION_UNCERTAIN_HEADERS,
          })
        }
        throw error
      }

      const resendError = delivery.error as (typeof delivery.error & {
        name?: unknown
        statusCode?: unknown
      }) | null
      const resendTransportOutcomeUnknown = Boolean(providerSignal && (
        providerSignal.aborted
        || (resendError?.name === 'application_error' && resendError.statusCode == null)
      ))
      if (resendTransportOutcomeUnknown) {
        const detail = dialerProviderDeadlineExceeded(providerSignal)
          ? 'Email provider timed out after submission; delivery could not be confirmed. Do not resend this email.'
          : 'Email provider connection ended after submission; delivery could not be confirmed. Do not resend this email.'
        return NextResponse.json({
          success: false,
          sent: null,
          persisted: false,
          code: 'delivery_unknown',
          deliveryState: 'delivery_unknown',
          error: detail,
        }, {
          status: 504,
          headers: DIALER_OPERATION_UNCERTAIN_HEADERS,
        })
      }

      if (delivery.error || !delivery.data?.id) {
        return NextResponse.json(
          { success: false, sent: false, error: delivery.error?.message || 'Email provider did not accept the message' },
          { status: 502 },
        )
      }

      if (reassertPersistenceControl) {
        try {
          await reassertPersistenceControl()
        } catch (error) {
          console.error('[CONVERSATIONS] Email delivered but dialing control could not be revalidated:', error)
          return NextResponse.json({
            success: true,
            sent: true,
            persisted: false,
            deliveryState: 'delivered_not_persisted',
            warning: 'Email delivered, but CRM history could not be saved. Do not resend this email.',
            id: delivery.data.id,
          })
        }
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
        if (reassertPersistenceControl) {
          await checkAutoAdvance(leadId, 'outbound_contact', {
            beforeMutation: reassertPersistenceControl,
          }).catch(err => console.error('[AUTO-ADVANCE] Failed:', err))
        } else {
          checkAutoAdvance(leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))
        }
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
