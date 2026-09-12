import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { EmailWorkspaceConfig } from './config'

export const emailRoles = ['owner', 'marketer', 'reviewer', 'acquisitions', 'reader'] as const
export type EmailRole = (typeof emailRoles)[number]
export interface EmailMembership { id: string; workspaceId: string; authUserId: string; roles: EmailRole[]; active: boolean; revision: number }

export interface EmailSettingsRepository {
  findActiveMembershipBySubject(subject: string): Promise<EmailMembership | null>
  getWorkspace(workspaceId: string): Promise<{ id: string; config: EmailWorkspaceConfig; revision: number; sendEnabled: boolean; aiAutoEnabled: boolean } | null>
  saveWorkspace(input: { workspaceId: string; expectedRevision?: number; config: EmailWorkspaceConfig; sendEnabled?: boolean; aiAutoEnabled?: boolean; pauseReason?: string | null }): Promise<{ id: string; revision: number }>
  findMembership(workspaceId: string, authUserId: string): Promise<EmailMembership | null>
  countActiveOwners(workspaceId: string): Promise<number>
  saveMembershipRoles(input: { workspaceId: string; authUserId: string; roles: EmailRole[]; active: boolean; expectedRevision?: number }): Promise<EmailMembership>
  createRemovalHold(input: { workspaceId: string; removedAuthUserId: string; backupAuthUserId?: string; affectedWorkHash: string }): Promise<void>
  getReceipt(workspaceId: string, actorId: string, idempotencyKey: string): Promise<{ payloadHash: string; result: unknown } | null>
  saveReceipt(input: { workspaceId: string; actorId: string; idempotencyKey: string; command: string; payloadHash: string; result: unknown }): Promise<void>
  audit(input: { workspaceId: string; actorId: string; action: string; entityId: string; requestId: string; detail: Record<string, unknown> }): Promise<void>
}

export function getEmailAdminDb(): EmailSettingsRepository {
  const db = supabaseAdmin()
  return {
    async findActiveMembershipBySubject(subject) {
      const { data, error } = await db.from('em_memberships').select('id,workspace_id,auth_user_id,roles,active,revision').eq('auth_user_id', subject).eq('active', true).maybeSingle()
      if (error) throw error
      if (!data) return null
      return { id: data.id, workspaceId: data.workspace_id, authUserId: data.auth_user_id, roles: data.roles as EmailRole[], active: data.active, revision: data.revision }
    },
    async getWorkspace(workspaceId) {
      const { data, error } = await db.from('em_workspaces').select('id,config,revision,send_enabled,ai_auto_enabled').eq('id', workspaceId).maybeSingle()
      if (error) throw error
      return data ? { id: data.id, config: data.config as EmailWorkspaceConfig, revision: data.revision, sendEnabled: data.send_enabled, aiAutoEnabled: data.ai_auto_enabled } : null
    },
    async saveWorkspace(input) {
      const query = db.from('em_workspaces').update({ config: input.config, send_enabled: input.sendEnabled, ai_auto_enabled: input.aiAutoEnabled, pause_reason: input.pauseReason, revision: (input.expectedRevision ?? 0) + 1 }).eq('id', input.workspaceId)
      const { data, error } = input.expectedRevision === undefined ? await query.select('id,revision').single() : await query.eq('revision', input.expectedRevision).select('id,revision').maybeSingle()
      if (error) throw error
      if (!data) throw new Error('STALE_REVISION')
      return { id: data.id, revision: data.revision }
    },
    async findMembership(workspaceId, authUserId) { const { data, error } = await db.from('em_memberships').select('id,workspace_id,auth_user_id,roles,active,revision').eq('workspace_id', workspaceId).eq('auth_user_id', authUserId).maybeSingle(); if (error) throw error; return data ? { id: data.id, workspaceId: data.workspace_id, authUserId: data.auth_user_id, roles: data.roles as EmailRole[], active: data.active, revision: data.revision } : null },
    async countActiveOwners(workspaceId) { const { count, error } = await db.from('em_memberships').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('active', true).contains('roles', ['owner']); if (error) throw error; return count ?? 0 },
    async saveMembershipRoles(input) { const query = db.from('em_memberships').update({ roles: input.roles, active: input.active, revision: (input.expectedRevision ?? 0) + 1 }).eq('workspace_id', input.workspaceId).eq('auth_user_id', input.authUserId); const { data, error } = input.expectedRevision === undefined ? await query.select('id,workspace_id,auth_user_id,roles,active,revision').single() : await query.eq('revision', input.expectedRevision).select('id,workspace_id,auth_user_id,roles,active,revision').maybeSingle(); if (error) throw error; if (!data) throw new Error('STALE_REVISION'); return { id: data.id, workspaceId: data.workspace_id, authUserId: data.auth_user_id, roles: data.roles as EmailRole[], active: data.active, revision: data.revision } },
    async createRemovalHold(input) { const { error } = await db.from('em_membership_holds').insert({ workspace_id: input.workspaceId, removed_auth_user_id: input.removedAuthUserId, backup_auth_user_id: input.backupAuthUserId, affected_work_hash: input.affectedWorkHash }); if (error) throw error },
    async getReceipt(workspaceId, actorId, idempotencyKey) { const { data, error } = await db.from('em_command_receipts').select('payload_hash,result').eq('workspace_id', workspaceId).eq('actor_id', actorId).eq('idempotency_key', idempotencyKey).maybeSingle(); if (error) throw error; return data ? { payloadHash: data.payload_hash, result: data.result } : null },
    async saveReceipt(input) { const { error } = await db.from('em_command_receipts').insert({ workspace_id: input.workspaceId, actor_id: input.actorId, idempotency_key: input.idempotencyKey, command: input.command, payload_hash: input.payloadHash, result: input.result }); if (error) throw error },
    async audit(input) { const { error } = await db.from('em_audit_events').insert({ workspace_id: input.workspaceId, actor_id: input.actorId, action: input.action, entity_id: input.entityId, request_id: input.requestId, detail: input.detail }); if (error) throw error },
  }
}
