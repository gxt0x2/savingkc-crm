/**
 * Bridge inbound SMS (from the Twilio webhook) into the SmarterContact inbox.
 * Fire-and-forget and fully self-contained: never throws into the caller, so
 * it can be dropped into the existing webhook without affecting its response.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recordInbound } from './messaging'
import { handleKeywordInbound } from './keywords'
import { stopWorkflowsOnReply } from './workflow-triggers'
import { isStopKeyword } from '@/lib/sms-opt-out'

export async function recordScInbound(params: {
  from: string
  to: string
  body: string
  sid?: string
  missedCall?: boolean
}): Promise<void> {
  try {
    const { conversationId } = await recordInbound({
      fromPhone: params.from,
      toPhone: params.to,
      body: params.body,
      twilioSid: params.sid,
      missedCall: params.missedCall,
    })

    const db = supabaseAdmin()

    // Reflect opt-out on the thread so the "Opted out" inbox filter works.
    if (isStopKeyword(params.body)) {
      await db.from('sc_conversations').update({ opted_out: true }).eq('id', conversationId)
    } else {
      // A genuine reply stops any active drip sequences, and may match a
      // keyword campaign auto-responder. Both are best-effort.
      await stopWorkflowsOnReply(params.from).catch((e) =>
        console.error('[SC] stopWorkflowsOnReply failed:', e),
      )
      await handleKeywordInbound({ from: params.from, to: params.to, body: params.body }).catch(
        (e) => console.error('[SC] handleKeywordInbound failed:', e),
      )
    }

    // Link the conversation to a known sc_contact by phone, if one exists and
    // it isn't linked yet.
    const { data: convo } = await db
      .from('sc_conversations')
      .select('contact_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convo && !convo.contact_id) {
      const { data: contact } = await db
        .from('sc_contacts')
        .select('id')
        .eq('phone', params.from)
        .maybeSingle()
      if (contact) {
        await db
          .from('sc_conversations')
          .update({ contact_id: contact.id })
          .eq('id', conversationId)
      }
    }
  } catch (err) {
    console.error('[SC] recordScInbound failed:', err)
  }
}
