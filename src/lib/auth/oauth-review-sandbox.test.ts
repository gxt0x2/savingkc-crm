import { describe, expect, it } from 'vitest'
import {
  OAUTH_REVIEW_SANDBOX_EMAIL,
  OAUTH_REVIEW_SANDBOX_LEAD_ID,
  OAUTH_REVIEW_SANDBOX_USER_ID,
  isOauthReviewSandboxIdentity,
  oauthReviewSandboxAllowsLead,
  oauthReviewSandboxLeadId,
} from './oauth-review-sandbox'

describe('oauth review sandbox identity', () => {
  it('locks the review email and auth user id to the sandbox lead', () => {
    expect(oauthReviewSandboxLeadId({ email: 'OAuth-Review@SavingKC.com' })).toBe(OAUTH_REVIEW_SANDBOX_LEAD_ID)
    expect(oauthReviewSandboxLeadId({ userId: OAUTH_REVIEW_SANDBOX_USER_ID.toUpperCase() })).toBe(OAUTH_REVIEW_SANDBOX_LEAD_ID)
    expect(isOauthReviewSandboxIdentity({ email: OAUTH_REVIEW_SANDBOX_EMAIL, userId: 'someone-else' })).toBe(true)
  })

  it('leaves Casey, Ernest, and Gertha unrestricted', () => {
    for (const email of ['casey@savingkc.com', 'ernest@savingkc.com', 'gertha@savingkc.com']) {
      expect(oauthReviewSandboxLeadId({ email, userId: '11111111-1111-4111-8111-111111111111' })).toBeNull()
      expect(oauthReviewSandboxAllowsLead(null, 'any-lead')).toBe(true)
    }
  })

  it('allows only the sandbox lead once the account is locked', () => {
    const allowed = oauthReviewSandboxLeadId({ email: OAUTH_REVIEW_SANDBOX_EMAIL })
    expect(oauthReviewSandboxAllowsLead(allowed, OAUTH_REVIEW_SANDBOX_LEAD_ID)).toBe(true)
    expect(oauthReviewSandboxAllowsLead(allowed, '00000000-0000-4000-8000-000000000099')).toBe(false)
    expect(oauthReviewSandboxAllowsLead(allowed, null)).toBe(false)
  })
})
