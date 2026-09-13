import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

export const emailRoles = [
  'owner',
  'marketer',
  'reviewer',
  'acquisitions',
  'reader',
] as const
export type EmailRole = (typeof emailRoles)[number]
export interface EmailMembership {
  id: string
  workspaceId: string
  authUserId: string
  roles: EmailRole[]
  active: boolean
  revision: number
}

/** Membership lookup is read-only. All settings writes use the workspace
 * transaction in workflow/service.ts; there is no multi-request mutation path. */
export function getEmailAdminDb() {
  const db = supabaseAdmin()
  return {
    async findActiveMembershipBySubject(
      subject: string,
    ): Promise<EmailMembership | null> {
      const { data, error } = await db
        .from('em_memberships')
        .select(
          'id,workspace_id,auth_user_id,roles,active,revision,agent_profile_id',
        )
        .eq('auth_user_id', subject)
        .eq('active', true)
        .maybeSingle()
      if (error) throw error
      if (!data?.agent_profile_id) return null
      const { data: profile, error: profileError } = await db
        .from('agent_profiles')
        .select('id,is_active,user_id')
        .eq('id', data.agent_profile_id)
        .maybeSingle()
      if (profileError) throw profileError
      if (
        !profile ||
        profile.is_active === false ||
        (profile.user_id && profile.user_id !== subject)
      )
        return null
      return data
        ? {
            id: data.id,
            workspaceId: data.workspace_id,
            authUserId: data.auth_user_id,
            roles: data.roles as EmailRole[],
            active: data.active,
            revision: data.revision,
          }
        : null
    },
  }
}
