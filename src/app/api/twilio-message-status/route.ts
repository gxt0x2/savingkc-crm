import { supabase } from '@/lib/supabase-lazy'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MESSAGE_SID = /^SM[0-9A-Za-z]{32}$/
const MESSAGE_STATUSES = new Set(['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered'])

function response(body: string, status: number) {
  return new Response(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function POST(request: Request) {
  let verified = false
  try {
    verified = await validateTwilioWebhook(request)
  } catch (error) {
    console.error('[twilio-message-status] Signature validation failed', error)
  }
  if (!verified) return response('Forbidden', 403)

  const actionId = new URL(request.url).searchParams.get('action_id')?.trim() || ''
  const form = await request.formData()
  const messageSid = String(form.get('MessageSid') || '').trim()
  const messageStatus = String(form.get('MessageStatus') || '').trim().toLowerCase()
  const errorCode = String(form.get('ErrorCode') || '').trim()
  if (!UUID.test(actionId) || !MESSAGE_SID.test(messageSid) || !MESSAGE_STATUSES.has(messageStatus)) {
    return response('Invalid delivery receipt', 400)
  }

  const { error } = await supabase.rpc('apply_prospecting_sms_delivery_v1', {
    p_action_id: actionId,
    p_message_sid: messageSid,
    p_message_status: messageStatus,
    p_error_code: errorCode || null,
  })
  if (error) {
    const detail = `${error.message || ''}`.toLowerCase()
    if (detail.includes('campaign_delivery_not_ready') || detail.includes('campaign_action_not_found')) {
      return response('Delivery receipt not ready', 503)
    }
    if (detail.includes('invalid_prospecting') || detail.includes('campaign_delivery_sid_mismatch')) {
      return response('Invalid delivery receipt', 400)
    }
    console.error('[twilio-message-status] Receipt persistence failed', { actionId, messageStatus, message: error.message })
    return response('Delivery receipt unavailable', 503)
  }
  return response('OK', 200)
}
