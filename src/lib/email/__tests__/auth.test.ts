import { describe, expect, it } from 'vitest'
import { canRunEmailCommand, requireEmailCommand, type EmailActor } from '../auth'
import { executeSettingsCommand, SettingsConflictError } from '../commands/settings'
import type { EmailSettingsRepository } from '../db'
import type { EmailWorkspaceConfig } from '../config'

const actor = (roles: EmailActor['roles']): EmailActor => ({ subject: '123e4567-e89b-12d3-a456-426614174000', email: 'owner@savingkc.com', name: 'Owner', workspaceId: '123e4567-e89b-12d3-a456-426614174001', membershipId: '123e4567-e89b-12d3-a456-426614174002', roles, revision: 1 })

describe('Email workspace authorization', () => {
  it('requires a server-resolved active actor', () => {
    expect(() => requireEmailCommand(null, 'SET-PAUSE')).toThrow(/verified active/i)
  })
  it('limits configuration and enablement to owners', () => {
    expect(canRunEmailCommand(actor(['owner']), 'SET-ENABLE')).toBe(true)
    expect(canRunEmailCommand(actor(['marketer']), 'SET-ENABLE')).toBe(false)
    expect(() => requireEmailCommand(actor(['reviewer']), 'SET-ROLES')).toThrow(/cannot perform/i)
  })
  it('permits an emergency pause to active operational roles but not readers', () => {
    expect(canRunEmailCommand(actor(['marketer']), 'SET-PAUSE')).toBe(true)
    expect(canRunEmailCommand(actor(['reviewer']), 'SET-PAUSE')).toBe(true)
    expect(canRunEmailCommand(actor(['acquisitions']), 'SET-PAUSE')).toBe(true)
    expect(canRunEmailCommand(actor(['reader']), 'SET-PAUSE')).toBe(false)
  })
})

describe('Email settings safety rules', () => {
  const workspaceId = '123e4567-e89b-12d3-a456-426614174001'
  const runId = '123e4567-e89b-12d3-a456-426614174003'
  const commandId = '123e4567-e89b-12d3-a456-426614174004'
  const store = (config: EmailWorkspaceConfig, enabled = false): EmailSettingsRepository => {
    let workspace = { id: workspaceId, config, revision: 2, sendEnabled: enabled, aiAutoEnabled: false }
    return {
      findActiveMembershipBySubject: async () => null,
      getWorkspace: async () => workspace,
      saveWorkspace: async (input) => { workspace = { ...workspace, config: input.config, sendEnabled: input.sendEnabled ?? workspace.sendEnabled, aiAutoEnabled: input.aiAutoEnabled ?? workspace.aiAutoEnabled, revision: workspace.revision + 1 }; return { id: workspace.id, revision: workspace.revision } },
      findMembership: async () => ({ id: commandId, workspaceId, authUserId: actor(['owner']).subject, roles: ['owner'], active: true, revision: 1 }),
      countActiveOwners: async () => 1,
      saveMembershipRoles: async (input) => ({ id: commandId, workspaceId, authUserId: input.authUserId, roles: input.roles, active: input.active, revision: 2 }),
      createRemovalHold: async () => undefined,
      getReceipt: async () => null,
      saveReceipt: async () => undefined,
      audit: async () => undefined,
    }
  }
  it('does not enable sending without exact current readiness evidence', async () => {
    await expect(executeSettingsCommand({ command: 'SET-ENABLE', idempotencyKey: commandId, payload: { readinessRunId: runId, configHash: 'current-evidence-hash' } }, actor(['owner']), store({}))).rejects.toMatchObject({ code: 'CURRENT_READINESS_REQUIRED' } satisfies Partial<SettingsConflictError>)
  })
  it('persists an emergency pause without readiness evidence', async () => {
    const outcome = await executeSettingsCommand({ command: 'SET-PAUSE', idempotencyKey: commandId, payload: { reason: 'Provider incident needs human review' } }, actor(['reviewer']), store({}, true))
    expect(outcome).toMatchObject({ ok: true, state: 'paused' })
  })
  it('protects the last owner from removal', async () => {
    await expect(executeSettingsCommand({ command: 'SET-ROLES', idempotencyKey: commandId, expectedRevision: 1, payload: { authUserId: actor(['owner']).subject, roles: ['reader'], active: false, affectedWorkHash: 'affected-work-hash' } }, actor(['owner']), store({}))).rejects.toMatchObject({ code: 'LAST_OWNER' } satisfies Partial<SettingsConflictError>)
  })
})
