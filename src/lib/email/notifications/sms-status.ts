import 'server-only'
import type { Sql } from 'postgres'
import { z } from 'zod'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { alertFailure } from './sms-worker'
import type { Tx } from '../workflow/core'

export function createLeadSmsStatusHttp(deps: { database: () => Sql; validate?: (req: Request) => Promise<boolean> }) {
  return async (request: Request) => {
    try {
      if ((await request.clone().text()).length>16_000) return new Response(null,{status:413})
      if (!(await (deps.validate ?? validateTwilioWebhook)(request))) return new Response(null,{status:403})
      const id = new URL(request.url).searchParams.get('id')
      const form = await request.formData()
      const sid = String(form.get('MessageSid') ?? '')
      const status = String(form.get('MessageStatus') ?? '')
      const phone = normalizePhoneToE164(String(form.get('To') ?? ''))
      if (!z.string().uuid().safeParse(id).success || !/^SM[0-9a-f]{32}$/i.test(sid) ||
        !['queued','accepted','sending','sent','delivered','undelivered','failed'].includes(status)) return new Response(null,{status:400})
      await deps.database().begin(async transaction => {
        const tx = transaction as unknown as Tx
        const [row] = await tx`select a.*,h.thread_id from em_lead_sms_alerts a join em_handoffs h on h.id=a.handoff_id
          where a.id=${id} for update of a`
        if (!row || !row.submitted_at || row.recipient_phone!==phone || (row.provider_sid && row.provider_sid!==sid)) return
        const failed = status==='undelivered' || status==='failed'
        if (row.state==='delivered' || row.state==='cancelled' || (row.state==='failed' && !failed && status!=='delivered')) return
        const state = status==='delivered' ? 'delivered' : failed ? 'failed' : 'accepted'
        const now = new Date()
        await tx`update em_lead_sms_alerts set state=${state},provider_sid=${sid},provider_status=${status},
          delivered_at=case when ${state}='delivered' then ${now} else delivered_at end,
          last_error=${failed ? `Twilio delivery ${status}: ${String(form.get('ErrorCode') ?? 'unknown').slice(0,20)}` : null},updated_at=${now}
          where id=${id}`
        if (failed) await alertFailure(tx,row as Parameters<typeof alertFailure>[1],'Lead SMS failed — review delivery',now)
      })
      return new Response(null,{status:204})
    } catch { return new Response(null,{status:503}) }
  }
}
