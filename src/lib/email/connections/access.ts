import 'server-only'
import {
  credentialKeyring,
  currentCredentialVersion,
} from '../secrets'
import { check, type Tx } from '../workflow/core'

export function connectionMasterKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  const keys = credentialKeyring(env)
  const version = currentCredentialVersion(keys)
  return version ? (keys.get(version) ?? null) : null
}
export function connectionKeyVersion(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return currentCredentialVersion(credentialKeyring(env)) ?? 1
}
export async function ownerWorkspace(tx: Tx, subject: string) {
  const [member] = await tx`select m.workspace_id from em_memberships m
    join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false
      and (p.user_id is null or p.user_id=m.auth_user_id)
    where m.auth_user_id=${subject} and m.active and 'owner'=any(m.roles)`
  check(member, 'FORBIDDEN', 403)
  const [workspace] =
    await tx`select id,revision from em_workspaces where id=${member.workspace_id} for update`
  const [fresh] = await tx`select m.auth_user_id from em_memberships m
    join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false
      and (p.user_id is null or p.user_id=m.auth_user_id)
    where m.workspace_id=${workspace.id} and m.auth_user_id=${subject} and m.active and 'owner'=any(m.roles)`
  check(fresh, 'FORBIDDEN', 403)
  return workspace
}
