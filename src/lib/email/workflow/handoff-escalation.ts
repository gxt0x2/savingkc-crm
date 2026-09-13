import 'server-only'
import { emailWorkspaceConfigSchema } from '../config'
import type { Context } from './core'
import { pilotOperatingDeadline } from './schedule'

export const HANDOFF_ACK_ESCALATION_MINUTES = 5

/** Escalate unacknowledged callback alerts to the saved backup after the
 * operating-hour acknowledgment target. No push, SMS or provider send. */
export async function escalateDueHandoffAlerts(context: Context) {
  const { tx, member, now } = context
  const [workspace] =
    await tx`select config from em_workspaces where id=${member.workspace_id}`
  const team = emailWorkspaceConfigSchema.parse(workspace.config).team
  const open =
    await tx`select n.id,n.thread_id,n.created_at,n.recipient_id,h.id as handoff_id,h.backup_id
    from em_notifications n
    join em_handoffs h on h.workspace_id=n.workspace_id and h.thread_id=n.thread_id
      and n.logical_key like ('handoff:' || h.id || '%')
    where n.workspace_id=${member.workspace_id} and n.acknowledged_at is null
      and h.state <> 'completed' and h.backup_id is not null and h.backup_id <> n.recipient_id
      and n.logical_key not like 'handoff-escalation:%'`
  let created = 0
  const seen = new Set<string>()
  for (const notice of open) {
    if (seen.has(notice.handoff_id)) continue
    seen.add(notice.handoff_id)
    const due = pilotOperatingDeadline(
      new Date(notice.created_at),
      HANDOFF_ACK_ESCALATION_MINUTES,
      team,
    )
    if (due.getTime() > now.getTime()) continue
    const [backup] =
      await tx`select m.auth_user_id from em_memberships m
      join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id)
      where m.workspace_id=${member.workspace_id} and m.auth_user_id=${notice.backup_id} and m.active
        and m.roles && array['owner','acquisitions']::text[]`
    if (!backup) continue
    const [existing] =
      await tx`select id from em_notifications where workspace_id=${member.workspace_id}
      and logical_key=${`handoff-escalation:${notice.handoff_id}`}`
    if (existing) continue
    await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
      values(${member.workspace_id},${notice.thread_id},${notice.backup_id},
      'Callback unacknowledged — backup review needed',${`handoff-escalation:${notice.handoff_id}`},${now})
      on conflict do nothing`
    created += 1
  }
  return created
}
