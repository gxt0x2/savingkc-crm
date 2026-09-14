import 'server-only'
import type { Sql } from 'postgres'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { pilotCallbackDue } from '../workflow/schedule'
import type { Tx } from '../workflow/core'
import { leadSmsEnabled, sendLeadAlertSms } from './sms-provider'

export interface AlertSendResult { success: boolean; sid?: string; status?: string; error?: string; deliveryUnknown?: boolean }
type Sender = (input: { id: string; phone: string; body: string }) => Promise<AlertSendResult>

export async function alertFailure(tx: Tx, row: { workspace_id: string; thread_id: string; recipient_id: string; id: string }, kind: string, now: Date) {
  await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    select ${row.workspace_id},${row.thread_id},m.auth_user_id,${kind},${`sms-alert:${row.id}:failure`},${now}
    from em_memberships m where m.workspace_id=${row.workspace_id} and m.active
      and (m.auth_user_id=${row.recipient_id} or m.roles && array['owner']::text[]) on conflict do nothing`
}

/** Never retry a submission whose provider outcome is unknown. */
export async function processLeadSmsAlerts(sql: Sql, owner: string, options: {
  enabled?: boolean; send?: Sender; now?: () => Date
} = {}) {
  if (!(options.enabled ?? leadSmsEnabled())) return { state: 'disabled' }
  const now = options.now?.() ?? new Date()
  const claimed = await sql.begin(async transaction => {
    const tx = transaction as unknown as Tx
    const [member] = await tx`select m.workspace_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id
      where m.auth_user_id=${owner} and m.active and m.roles && array['owner']::text[]
      and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)`
    if (!member) throw new Error('SMS_WORKER_OWNER_REQUIRED')
    const [workspace] = await tx`select id,config from em_workspaces where id=${member.workspace_id} for update`
    const ws = workspace.id
    const abandoned = await tx`update em_lead_sms_alerts a set state='unknown',last_error='Submission interrupted; provider reconciliation required',updated_at=${now}
      from em_handoffs h where a.workspace_id=${ws} and a.handoff_id=h.id and a.state='submitting'
      and a.submitted_at<${new Date(now.getTime()-120_000)} returning a.*,h.thread_id`
    for (const row of abandoned) await alertFailure(tx, row as Parameters<typeof alertFailure>[1], 'SMS delivery unknown — review required', now)
    await tx`insert into em_lead_sms_alerts(workspace_id,handoff_id,notification_id,recipient_id,phase,created_at)
      select a.workspace_id,a.handoff_id,a.notification_id,h.backup_id,'backup',${now}
      from em_lead_sms_alerts a join em_handoffs h on h.id=a.handoff_id
      join em_notifications n on n.id=a.notification_id
      where a.workspace_id=${ws} and a.phase='owner' and a.response_due_at<=${now}
      and a.state in ('accepted','delivered','failed','unknown') and n.acknowledged_at is null
      and h.owner_id=a.recipient_id and h.state='needs_contact' and h.crm_sync_state='synced'
      on conflict(handoff_id,recipient_id,phase) do nothing`
    const rows = await tx`select a.*,h.thread_id,h.owner_id,h.backup_id,h.state as handoff_state,h.crm_sync_state,
      h.seller_interest_confirmed,h.requested_contact,h.lead_id,n.acknowledged_at,t.state as thread_state,
      p.phone,p.full_name,p.email,p.is_active,m.active as member_active,l.assigned_agent,l.classification,l.is_parked,l.station,
      l.full_name as lead_name,w.status as task_status,w.assigned_to,c.name as campaign_name,
      email_crm_assignee_name(op.email,op.full_name) as owner_name
      from em_lead_sms_alerts a join em_handoffs h on h.id=a.handoff_id
      join em_notifications n on n.id=a.notification_id join em_threads t on t.id=h.thread_id
      join em_campaigns c on c.id=t.campaign_id join leads l on l.id=h.lead_id
      left join work_items w on w.work_item_key=h.crm_task_key
      left join em_memberships m on m.workspace_id=a.workspace_id and m.auth_user_id=a.recipient_id
      left join agent_profiles p on p.id=m.agent_profile_id and (p.user_id is null or p.user_id=m.auth_user_id)
      left join em_memberships om on om.workspace_id=a.workspace_id and om.auth_user_id=h.owner_id and om.active
      left join agent_profiles op on op.id=om.agent_profile_id and op.is_active is distinct from false and (op.user_id is null or op.user_id=om.auth_user_id)
      where a.workspace_id=${ws} and a.state='queued' order by a.created_at,a.id limit 10 for update of a`
    for (const row of rows) {
      const recipientMatches = row.phase==='owner' ? row.recipient_id===row.owner_id : row.recipient_id===row.backup_id
      if (!recipientMatches || row.acknowledged_at || row.handoff_state!=='needs_contact' || row.crm_sync_state!=='synced' ||
        !row.seller_interest_confirmed || ['stopped','done'].includes(row.thread_state) || row.task_status!=='pending' ||
        !row.member_active || row.is_active===false || !row.owner_name || row.is_parked ||
        !['lead','opportunity'].includes(row.classification) || ['dead','closed_won','closed_lost'].includes(row.station) ||
        row.assigned_agent!==row.owner_name || row.assigned_to!==row.owner_name) {
        await tx`update em_lead_sms_alerts set state='cancelled',last_error='Assignment or callback eligibility changed',updated_at=${now} where id=${row.id}`
        continue
      }
      const phone = normalizePhoneToE164(row.phone)
      const due = pilotCallbackDue(now, workspace.config?.team)
      if (!phone) {
        await tx`update em_lead_sms_alerts set state='failed',last_error='Agent SMS number missing or invalid',response_due_at=${due},updated_at=${now} where id=${row.id}`
        await alertFailure(tx, row as Parameters<typeof alertFailure>[1], 'Lead SMS failed — agent phone needs review', now)
        continue
      }
      const prefix = row.campaign_name==='Controlled setup test' ? 'Controlled test — ' : ''
      const timing = row.requested_contact?.requestedTimeText ? 'Timing provided in the reply.' : 'No time specified.'
      const label = row.phase==='backup' ? 'Backup needed: email Lead not accepted' : 'New email Lead'
      const name = String(row.lead_name || 'Seller').replace(/[\r\n]+/g,' ').slice(0,65)
      const path = row.phase==='backup' ? `/leads/${row.lead_id}` : `/marketing/email?thread=${row.thread_id}`
      const action = row.phase==='backup' ? 'Review Lead and coordinate coverage' : 'Review and accept'
      const body = `${prefix}${label}: ${name}. Requested a call. ${timing} ${action}: https://crm.savingkc.com${path}`
      await tx`update em_lead_sms_alerts set state='submitting',recipient_phone=${phone},submitted_at=${now},response_due_at=${due},updated_at=${now} where id=${row.id}`
      return { id: String(row.id), workspace_id: String(row.workspace_id), thread_id: String(row.thread_id),
        recipient_id: String(row.recipient_id), phone, body }
    }
    return null
  })
  if (!claimed) return { state: 'idle' }
  let result: AlertSendResult
  try { result = await (options.send ?? sendLeadAlertSms)({ id: claimed.id, phone: claimed.phone, body: claimed.body }) }
  catch { result = { success: false, deliveryUnknown: true, error: 'Provider result unknown; do not resend' } }
  const state = result.success && result.sid?.startsWith('SM') ? 'accepted' : result.deliveryUnknown ? 'unknown' : 'failed'
  await sql.begin(async transaction => {
    const tx = transaction as unknown as Tx
    // A signed delivery callback may arrive before messages.create returns.
    await tx`update em_lead_sms_alerts set state=${state},provider_sid=${result.sid?.startsWith('SM') ? result.sid : null},
      provider_status=${result.status ?? null},last_error=${result.error ?? null},updated_at=${now}
      where id=${claimed.id} and state='submitting'`
    if (state==='failed' || state==='unknown') await alertFailure(tx, claimed as Parameters<typeof alertFailure>[1],
      state==='failed' ? 'Lead SMS failed — review delivery' : 'Lead SMS delivery unknown — review required', now)
  })
  return { state, alertId: claimed.id }
}
