/** Shared newsletter copy. Safe to import from client components. */

export const NEWSLETTER_EDITIONS = ['tuesday_note', 'tuesday_deal_desk'] as const
export type NewsletterEditionKey = (typeof NEWSLETTER_EDITIONS)[number]

export const NEWSLETTER_ROLES = ['seller', 'buyer'] as const
export type NewsletterRole = (typeof NEWSLETTER_ROLES)[number]

export const NEWSLETTER_COUNTIES = [
  'Jackson',
  'Clay',
  'Platte',
  'Cass',
  'Johnson KS',
  'Wyandotte KS',
  'Other',
] as const
export type NewsletterCounty = (typeof NEWSLETTER_COUNTIES)[number]

export const NEWSLETTER_BRAND = 'Saving KC Homebuyers'
export const NEWSLETTER_FROM_NAME = 'Ernest Dodson, Saving KC Homebuyers'
export const NEWSLETTER_FROM_MAILBOX = 'ernest@talktosavingkc.com'
export const NEWSLETTER_CALL_URL = 'https://savingkc.com/call'
export const NEWSLETTER_COMPANY_PHONE = '(816) 429-2900'
export const NEWSLETTER_LICENSE_LINE =
  'Ernest Dodson, Missouri-licensed real estate salesperson with Platinum Realty LLC, MO #2023026433.'

export const NEWSLETTER_CONSENT_TEXT =
  'I agree to receive the Tuesday newsletter by email from Saving KC Homebuyers. I can unsubscribe anytime.'

export const NEWSLETTER_SIGNUP_SUCCESS =
  'Got it. If this address can receive the newsletter, you are on the list.'

export const SELLER_STORY_PLACEHOLDER =
  '[ERNEST STORY: 2 or 3 true sentences. A real moment with a homeowner (no names) who was stressed about a tax bill, or your own first tax bill.]'

export const BUYER_STORY_PLACEHOLDER =
  '[ERNEST STORY: 2 or 3 true sentences. A real time the numbers on a house did not work and you walked away, or the best buying lesson you have learned.]'

/** Exact env value required before any future enablement. Unset means hold. */
export const NEWSLETTER_OWNER_APPROVAL_VALUE = 'approved'

export function newsletterEditionForRole(role: NewsletterRole): NewsletterEditionKey {
  return role === 'seller' ? 'tuesday_note' : 'tuesday_deal_desk'
}

export function newsletterTags(role: NewsletterRole, county: NewsletterCounty): string[] {
  const countyTag = county.toLowerCase().replace(/\s+/g, '-')
  const edition = newsletterEditionForRole(role).replaceAll('_', '-')
  return [
    `role:${role}`,
    `edition:${edition}`,
    `county:${countyTag}`,
    'source:newsletter-signup',
    'consent:recorded',
  ]
}
