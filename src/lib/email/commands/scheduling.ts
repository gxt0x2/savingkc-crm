import 'server-only'
import type { EmailCommand } from '../contracts'
import { canEnableAutomaticBooking } from '../calendar'
import {
  WorkflowError,
  check,
  json,
  type Context,
  type Result,
} from '../workflow/core'

const commands = new Set(['SCH-POLICY', 'SCH-RESCHEDULE', 'SCH-CANCEL'])
export const isSchedulingCommand = (command: string) => commands.has(command)
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

export async function applySchedulingCommand(
  context: Context,
  command: EmailCommand,
): Promise<Result> {
  const { tx, member, now } = context,
    ws = member.workspace_id
  check(isSchedulingCommand(command.command), 'ACTION_NOT_IMPLEMENTED', 400)
  if (command.command !== 'SCH-POLICY')
    throw new WorkflowError('CALENDAR_NOT_CONNECTED')
  check(member.roles.includes('owner'), 'FORBIDDEN', 403)
  const p = command.payload
  check(p.hours.timezone === 'America/Chicago', 'CHICAGO_TIMEZONE_REQUIRED', 400)
  check(
    p.hours.weekdays.every((d) => weekdays.includes(d)) &&
      p.hours.startLocal >= '08:30' &&
      p.hours.startLocal < p.hours.endLocal,
    'INVALID_TEAM_HOURS',
    400,
  )
  for (const agent of p.agentCalendars) {
    const [assignee] =
      await tx`select m.auth_user_id from em_memberships m join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id)
      where m.workspace_id=${ws} and m.auth_user_id=${agent} and m.active`
    check(assignee, 'TEAM_MEMBER_INACTIVE')
  }
  check(
    !canEnableAutomaticBooking({
      calendarConnected: false,
      tokenFresh: false,
      hoursValid: true,
      alertsConfigured: p.alertCheckIds.length > 0,
    }),
    'CALENDAR_NOT_CONNECTED',
  )
  check(!p.enabled, 'CALENDAR_NOT_CONNECTED')
  await tx`insert into em_scheduling_policies(workspace_id,enabled,agent_calendars,hours,duration_minutes,buffer_minutes,max_daily_bookings,alert_check_ids,revision,updated_at)
    values(${ws},false,${p.agentCalendars},${tx.json(json(p.hours))},${p.durationMinutes},${p.bufferMinutes},${p.maxDailyBookings},${p.alertCheckIds},1,${now})
    on conflict (workspace_id) do update set enabled=false,agent_calendars=${p.agentCalendars},hours=${tx.json(json(p.hours))},
      duration_minutes=${p.durationMinutes},buffer_minutes=${p.bufferMinutes},max_daily_bookings=${p.maxDailyBookings},
      alert_check_ids=${p.alertCheckIds},revision=em_scheduling_policies.revision+1,updated_at=${now}`
  const [saved] =
    await tx`select revision from em_scheduling_policies where workspace_id=${ws}`
  return { entityId: ws, revision: saved.revision, state: 'calendar_policy_saved_manual' }
}
