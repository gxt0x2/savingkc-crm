import 'server-only'
import type { EmailCommand } from '../contracts'
import { inboxQueryAllowlisted } from '../inbox-filters'
import {
  WorkflowError,
  check,
  json,
  type Context,
  type Result,
} from '../workflow/core'

const commands = new Set(['INB-SAVEVIEW', 'INB-DELETEVIEW'])
export const isInboxViewCommand = (command: string) => commands.has(command)

export async function applyInboxViewCommand(
  context: Context,
  command: EmailCommand,
): Promise<Result> {
  const { tx, member, now } = context,
    ws = member.workspace_id
  check(isInboxViewCommand(command.command), 'ACTION_NOT_IMPLEMENTED', 400)
  if (command.command === 'INB-DELETEVIEW') {
    const [view] =
      await tx`select * from em_inbox_views where workspace_id=${ws} and id=${command.payload.viewId} and owner_id=${member.auth_user_id} for update`
    check(view, 'SAVED_VIEW_NOT_FOUND', 404)
    check(command.payload.expectedRevision === view.revision, 'STALE_SAVED_VIEW')
    await tx`delete from em_inbox_views where workspace_id=${ws} and id=${view.id} and owner_id=${member.auth_user_id}`
    return { entityId: view.id, revision: view.revision, state: 'view_deleted' }
  }
  if (command.command !== 'INB-SAVEVIEW')
    throw new WorkflowError('ACTION_NOT_IMPLEMENTED', 400)
  const p = command.payload
  check(p.queryVersion === 1, 'UNSUPPORTED_QUERY_VERSION', 400)
  check(inboxQueryAllowlisted(p.query), 'INVALID_INBOX_QUERY', 400)
  if (p.query.ownerId) {
    const [owner] =
      await tx`select auth_user_id from em_memberships where workspace_id=${ws} and auth_user_id=${p.query.ownerId} and active`
    check(owner, 'TEAM_MEMBER_INACTIVE')
  }
  if (p.query.campaignId) {
    const [campaign] =
      await tx`select id from em_campaigns where workspace_id=${ws} and id=${p.query.campaignId}`
    check(campaign, 'CAMPAIGN_NOT_FOUND', 404)
  }
  if (p.viewId) {
    const [current] =
      await tx`select * from em_inbox_views where workspace_id=${ws} and id=${p.viewId} and owner_id=${member.auth_user_id} for update`
    check(current, 'SAVED_VIEW_NOT_FOUND', 404)
    check(p.expectedRevision === current.revision, 'STALE_SAVED_VIEW')
    const [saved] =
      await tx`update em_inbox_views set name=${p.name},query=${tx.json(json(p.query))},revision=revision+1,updated_at=${now}
      where workspace_id=${ws} and id=${current.id} returning revision`
    return { entityId: current.id, revision: saved.revision, state: 'view_saved' }
  }
  const [duplicate] =
    await tx`select id from em_inbox_views where workspace_id=${ws} and owner_id=${member.auth_user_id} and name=${p.name}`
  check(!duplicate, 'SAVED_VIEW_NAME_TAKEN')
  const [created] =
    await tx`insert into em_inbox_views(workspace_id,owner_id,name,query_version,query,updated_at)
    values(${ws},${member.auth_user_id},${p.name},1,${tx.json(json(p.query))},${now}) returning id,revision`
  return { entityId: created.id, revision: created.revision, state: 'view_saved' }
}
