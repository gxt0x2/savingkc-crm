/**
 * Google OAuth verification uses one throwaway CRM login. That login must
 * never read the live seller pipeline. Real agents are unchanged: this lock
 * matches only the review account's verified email or auth user id.
 */
export const OAUTH_REVIEW_SANDBOX_EMAIL = 'oauth-review@savingkc.com'
export const OAUTH_REVIEW_SANDBOX_USER_ID = 'ac386ea3-c81b-4671-833b-690854b3a1f0'
export const OAUTH_REVIEW_SANDBOX_LEAD_ID = '1a301114-1184-475b-beda-f7541dd30724'

export function isOauthReviewSandboxIdentity(input: {
  email?: string | null
  userId?: string | null
}): boolean {
  const email = input.email?.trim().toLowerCase() ?? ''
  const userId = input.userId?.trim().toLowerCase() ?? ''
  return email === OAUTH_REVIEW_SANDBOX_EMAIL || userId === OAUTH_REVIEW_SANDBOX_USER_ID
}

/** Null means the caller is a normal agent and keeps the existing query. */
export function oauthReviewSandboxLeadId(input: {
  email?: string | null
  userId?: string | null
}): string | null {
  return isOauthReviewSandboxIdentity(input) ? OAUTH_REVIEW_SANDBOX_LEAD_ID : null
}

export function oauthReviewSandboxAllowsLead(
  allowedLeadId: string | null,
  leadId: string | null | undefined,
): boolean {
  if (!allowedLeadId) return true
  return (leadId ?? '').trim().toLowerCase() === allowedLeadId
}
