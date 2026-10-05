import { loadActorGoogleOAuthToken } from '@/lib/gmail-send'
import { hasGoogleOAuthConfig } from '@/lib/gmail-sync'
import { CALENDAR_SCOPE, GMAIL_SEND_SCOPE, hasGoogleScope } from '@/lib/google-oauth-scopes'

export type MobileSessionEmailProvider = 'gmail' | 'none'

/**
 * Shape read by savingkc-mobile-crm build 32 (codex/mobile-live-integration).
 * LiveCrmProvider.refresh() treats capabilities.googleCalendar === true as the
 * calendar grant. parseMessagingPolicy treats capabilities.gmail === true or
 * messaging.email.provider === 'gmail' as the one-to-one send grant.
 * provider is never 'resend'. blastAllowed stays false.
 */
export type MobileSessionEmailMessaging = {
  provider: MobileSessionEmailProvider
  configured: boolean
  allowed: boolean
  blastAllowed: false
}

export type ActorGoogleSessionGrant = {
  googleCalendar: boolean
  gmail: boolean
  email: MobileSessionEmailMessaging
}

function closedGrant(): ActorGoogleSessionGrant {
  return {
    googleCalendar: false,
    gmail: false,
    email: {
      provider: 'none',
      configured: false,
      allowed: false,
      blastAllowed: false,
    },
  }
}

/**
 * Same eligibility formula as GET /api/mobile/v1/calendar/accounts:
 * OAuth config present, a readable actor grant, and the required scope.
 * A grant that cannot be read fails closed (false), not open.
 */
export async function readActorGoogleSessionGrant(
  actorEmail: string | null | undefined,
): Promise<ActorGoogleSessionGrant> {
  const email = actorEmail?.trim().toLowerCase() ?? ''
  if (!email) return closedGrant()

  try {
    const configured = hasGoogleOAuthConfig()
    const token = await loadActorGoogleOAuthToken(email)
    if (!configured || !token) return closedGrant()
    const googleCalendar = hasGoogleScope(token.scope, CALENDAR_SCOPE)
    const gmail = hasGoogleScope(token.scope, GMAIL_SEND_SCOPE)
    return {
      googleCalendar,
      gmail,
      email: gmail
        ? { provider: 'gmail', configured: true, allowed: true, blastAllowed: false }
        : closedGrant().email,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    console.warn(`[mobile-session] Google grant could not be read: ${message}`)
    return closedGrant()
  }
}
