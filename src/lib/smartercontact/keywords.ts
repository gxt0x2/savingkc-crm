/**
 * Keyword campaigns: inbound "text KEYWORD to <number>" auto-responders.
 *
 * Runs from the SmarterContact inbound bridge (fire-and-forget). Only exact
 * matches against an ACTIVE keyword campaign trigger a reply, so it won't
 * interfere with normal conversational messages. A dedup guard prevents a
 * double auto-reply.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scSendSms } from './messaging'
import { renderMessage } from './spintax'
import { isDuplicateSms } from '@/lib/sms-dedup'

/**
 * If the inbound body exactly matches an active keyword campaign (optionally
 * scoped to the receiving number), send its auto-reply and enroll the contact.
 * Returns true if a keyword campaign matched.
 */
export async function handleKeywordInbound(params: {
  from: string
  to: string
  body: string
}): Promise<boolean> {
  const keyword = params.body.trim().toUpperCase()
  if (!keyword || keyword.length > 40) return false

  const db = supabaseAdmin()
  const { data: campaigns } = await db
    .from('sc_campaigns')
    .select('id, keyword, keyword_number, auto_reply_body, sending_number_ids, from_strategy, sent_count')
    .eq('type', 'keyword')
    .eq('status', 'active')

  if (!campaigns?.length) return false

  const match = campaigns.find((c) => {
    if (!c.keyword) return false
    if (c.keyword.trim().toUpperCase() !== keyword) return false
    // If the campaign is scoped to a specific inbound number, require it.
    if (c.keyword_number && c.keyword_number !== params.to) return false
    return true
  })
  if (!match || !match.auto_reply_body) return false

  // Ensure a contact record exists for this inbound number.
  let contactId: string | null = null
  const { data: existing } = await db
    .from('sc_contacts')
    .select('id')
    .eq('phone', params.from)
    .maybeSingle()
  if (existing) {
    contactId = existing.id
  } else {
    const { data: created } = await db
      .from('sc_contacts')
      .insert({ phone: params.from, source: `keyword:${keyword}` })
      .select('id')
      .single()
    contactId = created?.id ?? null
  }

  // Render + send the auto-reply (guard against a duplicate send).
  const ctx = { phone: params.from }
  const replyBody = renderMessage(match.auto_reply_body, ctx, params.from)
  if (await isDuplicateSms(params.from, replyBody)) return true

  const res = await scSendSms({
    toPhone: params.from,
    body: replyBody,
    poolIds:
      match.from_strategy === 'pool' && match.sending_number_ids?.length
        ? match.sending_number_ids
        : undefined,
    // Reply from the number they texted so the keyword stays consistent.
    forceFrom: match.keyword_number || params.to || undefined,
    contactId,
    campaignId: match.id,
    sticky: true,
  })

  if (res.success) {
    await db
      .from('sc_campaigns')
      .update({ sent_count: (match.sent_count || 0) + 1 })
      .eq('id', match.id)
  }
  return true
}
