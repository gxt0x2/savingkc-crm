import 'server-only'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { type EmailRole, getEmailAdminDb } from './db'
import type { EmailCommandId } from './contracts'

export interface EmailActor { subject: string; email: string; name: string; workspaceId: string; membershipId: string; roles: EmailRole[]; revision: number }

const capabilities: Record<'configure' | 'pause', readonly EmailRole[]> = {
  configure: ['owner'],
  pause: ['owner', 'marketer', 'reviewer', 'acquisitions'],
}

export async function resolveEmailActor(request?: Request): Promise<EmailActor | null> {
  const actor = await resolveAuthenticatedActor(request)
  if (!actor?.subject) return null
  const subject = actor.subject
  const membership = await getEmailAdminDb().findActiveMembershipBySubject(subject)
  if (!membership) return null
  return { subject, email: actor.email, name: actor.name, workspaceId: membership.workspaceId, membershipId: membership.id, roles: membership.roles, revision: membership.revision }
}

export function requiredEmailCapability(command: EmailCommandId): 'configure' | 'pause' | null {
  if (command === 'SET-PAUSE') return 'pause'
  if (['SET-BUSINESS', 'SET-TEAM', 'SET-ROLES', 'SET-AUTOMATION', 'SET-ENABLE'].includes(command)) return 'configure'
  return null
}

export function canRunEmailCommand(actor: EmailActor, command: EmailCommandId) {
  const capability = requiredEmailCapability(command)
  return capability === null || actor.roles.some((role) => capabilities[capability].includes(role))
}

export function requireEmailCommand(actor: EmailActor | null, command: EmailCommandId): asserts actor is EmailActor {
  if (!actor) throw new EmailAuthorizationError('NO_SESSION', 'A verified active Email workspace membership is required.')
  if (!canRunEmailCommand(actor, command)) throw new EmailAuthorizationError('FORBIDDEN', 'Your active Email workspace role cannot perform this action.')
}

export class EmailAuthorizationError extends Error { constructor(public readonly code: 'NO_SESSION' | 'FORBIDDEN', message: string) { super(message) } }
