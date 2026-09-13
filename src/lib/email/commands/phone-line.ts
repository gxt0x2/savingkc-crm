import 'server-only'
import type { EmailCommand } from '../contracts'
import {
  RESERVED_ADS_NUMBER_ID,
  canSaveResponseLine,
  canTestResponseLine,
  responseLineStateAfterSave,
} from '../phone-line'
import {
  WorkflowError,
  check,
  json,
  type Context,
  type Result,
} from '../workflow/core'

const commands = new Set(['TEL-SAVE', 'TEL-TEST'])
export const isPhoneLineCommand = (command: string) => commands.has(command)

export async function applyPhoneLineCommand(
  context: Context,
  command: EmailCommand,
): Promise<Result> {
  const { tx, member, now } = context,
    ws = member.workspace_id
  check(isPhoneLineCommand(command.command), 'ACTION_NOT_IMPLEMENTED', 400)
  check(member.roles.includes('owner'), 'FORBIDDEN', 403)
  if (command.command !== 'TEL-SAVE') {
    const [line] =
      command.command === 'TEL-TEST'
        ? await tx`select state from em_response_lines where workspace_id=${ws} and id=${command.payload.lineId}`
        : []
    check(
      canTestResponseLine(line?.state ?? ''),
      'RESPONSE_LINE_NOT_PROVISIONED',
    )
    throw new WorkflowError('RESPONSE_LINE_NOT_PROVISIONED')
  }
  const p = command.payload
  check(
    p.existingProviderNumberId !== RESERVED_ADS_NUMBER_ID,
    'RESERVED_NUMBER_PROTECTED',
    400,
  )
  check(
    canSaveResponseLine({
      existingProviderNumberId: p.existingProviderNumberId,
      purpose: p.purpose,
      purchase: false,
    }),
    'EMAIL_RESPONSE_PURPOSE_REQUIRED',
    400,
  )
  check(p.hours.timezone === 'America/Chicago', 'CHICAGO_TIMEZONE_REQUIRED', 400)
  await tx`insert into em_response_lines(workspace_id,existing_provider_number_id,purpose,routing_policy,hours,voicemail,caller_id_policy,state,revision)
    values(${ws},${p.existingProviderNumberId},${p.purpose},${p.routingPolicy},${tx.json(json(p.hours))},${p.voicemail},${p.callerIdPolicy},'intended',0)
    on conflict (workspace_id) do update set existing_provider_number_id=${p.existingProviderNumberId},routing_policy=${p.routingPolicy},
      hours=${tx.json(json(p.hours))},voicemail=${p.voicemail},caller_id_policy=${p.callerIdPolicy},state='intended',revision=em_response_lines.revision+1`
  const [saved] =
    await tx`select id,revision from em_response_lines where workspace_id=${ws}`
  void now
  return {
    entityId: saved.id,
    revision: saved.revision,
    state: `response_line_${responseLineStateAfterSave()}`,
  }
}
