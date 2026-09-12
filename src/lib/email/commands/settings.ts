import { createHash } from 'node:crypto'
import type { EmailCommand, EmailCommandResult } from '../contracts'
import { currentReadiness, emailWorkspaceConfigSchema, type EmailWorkspaceConfig } from '../config'
import type { EmailActor } from '../auth'
import type { EmailSettingsRepository } from '../db'

type SettingsCommand = Extract<EmailCommand, { command: 'SET-BUSINESS' | 'SET-TEAM' | 'SET-ROLES' | 'SET-AUTOMATION' | 'SET-ENABLE' | 'SET-PAUSE' }>

function payloadHash(input: SettingsCommand) { return createHash('sha256').update(JSON.stringify(input)).digest('hex') }
function result(requestId: string, entityId: string, revision: number, state: string): EmailCommandResult { return { ok: true, requestId, entityId, revision, state, invalidates: ['email:workspace', 'email:settings'] } }

/**
 * Durable settings behavior shared by setup and the settings page. Authority is
 * resolved before this function; it never accepts a client workspace id.
 */
export async function executeSettingsCommand(command: SettingsCommand, actor: EmailActor, store: EmailSettingsRepository): Promise<EmailCommandResult> {
  const hash = payloadHash(command)
  const prior = await store.getReceipt(actor.workspaceId, actor.subject, command.idempotencyKey)
  if (prior) {
    if (prior.payloadHash !== hash) throw new SettingsConflictError('IDEMPOTENCY_MISMATCH')
    return prior.result as EmailCommandResult
  }
  const workspace = await store.getWorkspace(actor.workspaceId)
  if (!workspace) throw new SettingsConflictError('WORKSPACE_NOT_FOUND')
  if (command.command !== 'SET-ROLES' && command.expectedRevision !== undefined && command.expectedRevision !== workspace.revision) throw new SettingsConflictError('STALE_REVISION')

  const config = structuredClone(workspace.config) as EmailWorkspaceConfig
  let sendEnabled = workspace.sendEnabled
  let aiAutoEnabled = workspace.aiAutoEnabled
  let pauseReason: string | null | undefined
  let state = 'saved'
  if (command.command === 'SET-ROLES') {
    const membership = await store.findMembership(actor.workspaceId, command.payload.authUserId)
    if (!membership) throw new SettingsConflictError('MEMBERSHIP_NOT_FOUND')
    const removesOwner = membership.active && membership.roles.includes('owner') && (!command.payload.active || !command.payload.roles.includes('owner'))
    if (removesOwner && await store.countActiveOwners(actor.workspaceId) <= 1) throw new SettingsConflictError('LAST_OWNER')
    const savedMembership = await store.saveMembershipRoles({ workspaceId: actor.workspaceId, authUserId: membership.authUserId, roles: command.payload.roles, active: command.payload.active, expectedRevision: command.expectedRevision })
    if (!savedMembership.active) await store.createRemovalHold({ workspaceId: actor.workspaceId, removedAuthUserId: savedMembership.authUserId, backupAuthUserId: config.team?.backupId, affectedWorkHash: command.payload.affectedWorkHash })
    const durable = result(command.idempotencyKey, savedMembership.id, savedMembership.revision, savedMembership.active ? 'roles_saved' : 'work_held')
    await store.audit({ workspaceId: actor.workspaceId, actorId: actor.subject, action: command.command, entityId: savedMembership.id, requestId: command.idempotencyKey, detail: { active: savedMembership.active, roles: savedMembership.roles, holdCreated: !savedMembership.active } })
    await store.saveReceipt({ workspaceId: actor.workspaceId, actorId: actor.subject, idempotencyKey: command.idempotencyKey, command: command.command, payloadHash: hash, result: durable })
    return durable
  }
  switch (command.command) {
    case 'SET-BUSINESS': config.business = command.payload; config.readiness = undefined; state = 'readiness_required'; break
    case 'SET-TEAM': {
      const teamIds = [command.payload.reviewerId, command.payload.acquisitionOwnerId, command.payload.backupId]
      const members = await Promise.all(teamIds.map((authUserId) => store.findMembership(actor.workspaceId, authUserId)))
      if (members.some((member) => !member?.active)) throw new SettingsConflictError('TEAM_MEMBER_INACTIVE')
      config.team = command.payload
      config.readiness = undefined
      state = 'readiness_required'
      break
    }
    case 'SET-AUTOMATION':
      if (command.payload.mode === 'bounded_auto' && config.readiness?.state !== 'current') throw new SettingsConflictError('AUTOMATION_READINESS_REQUIRED')
      config.automation = command.payload
      if (command.payload.mode !== 'bounded_auto') aiAutoEnabled = false
      state = command.payload.mode === 'bounded_auto' ? 'bounded_auto_pending' : 'saved'
      break
    case 'SET-ENABLE':
      if (!currentReadiness(config, command.payload.readinessRunId, command.payload.configHash)) throw new SettingsConflictError('CURRENT_READINESS_REQUIRED')
      sendEnabled = true
      aiAutoEnabled = config.automation?.mode === 'bounded_auto'
      state = 'enabled'
      break
    case 'SET-PAUSE':
      sendEnabled = false
      aiAutoEnabled = false
      pauseReason = command.payload.reason
      state = 'paused'
      break
  }
  const parsedConfig = emailWorkspaceConfigSchema.parse(config)
  const saved = await store.saveWorkspace({ workspaceId: actor.workspaceId, expectedRevision: workspace.revision, config: parsedConfig, sendEnabled, aiAutoEnabled, pauseReason })
  const durable = result(command.idempotencyKey, saved.id, saved.revision, state)
  await store.audit({ workspaceId: actor.workspaceId, actorId: actor.subject, action: command.command, entityId: saved.id, requestId: command.idempotencyKey, detail: { state, sendEnabled, aiAutoEnabled } })
  await store.saveReceipt({ workspaceId: actor.workspaceId, actorId: actor.subject, idempotencyKey: command.idempotencyKey, command: command.command, payloadHash: hash, result: durable })
  return durable
}

export class SettingsConflictError extends Error { constructor(public readonly code: 'IDEMPOTENCY_MISMATCH' | 'WORKSPACE_NOT_FOUND' | 'STALE_REVISION' | 'CURRENT_READINESS_REQUIRED' | 'AUTOMATION_READINESS_REQUIRED' | 'MEMBERSHIP_NOT_FOUND' | 'TEAM_MEMBER_INACTIVE' | 'LAST_OWNER') { super(code) } }
