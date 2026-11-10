import { normalizeEmailAddress } from '../identity'
import {
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_COUNTIES,
  NEWSLETTER_ROLES,
  NEWSLETTER_SEGMENTS,
  NEWSLETTER_SIGNUP_SUCCESS,
  newsletterRoleForSegment,
  newsletterTags,
  type NewsletterCounty,
  type NewsletterRole,
  type NewsletterSegment,
} from './constants'

export type NewsletterContact = {
  email: string
  role: NewsletterRole
  segment: NewsletterSegment
  county: NewsletterCounty
  tags: string[]
  consent: {
    text: typeof NEWSLETTER_CONSENT_TEXT
    recordedAt: string
    source: string
  }
  status: 'subscribed'
}

export type NewsletterStore = {
  isSuppressed(email: string): Promise<boolean | 'unknown'>
  save(contact: NewsletterContact): Promise<'saved' | 'suppressed'>
}

export type SignupResult = {
  httpStatus: number
  body: { ok: true; status: 'received'; message: string } | { ok: false; error: string }
  stored: boolean
}

const SOURCE_PATTERN = /^[a-z0-9-]{1,80}$/

function isRole(value: unknown): value is NewsletterRole {
  return typeof value === 'string' && (NEWSLETTER_ROLES as readonly string[]).includes(value)
}

function isSegment(value: unknown): value is NewsletterSegment {
  return typeof value === 'string' && (NEWSLETTER_SEGMENTS as readonly string[]).includes(value)
}

function isCounty(value: unknown): value is NewsletterCounty {
  return typeof value === 'string' && (NEWSLETTER_COUNTIES as readonly string[]).includes(value)
}

export function parseNewsletterSignup(input: unknown, now: Date):
  | { ok: true; contact: NewsletterContact }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Check the form and try again.' }
  const body = input as Record<string, unknown>
  const normalized = typeof body.email === 'string' ? normalizeEmailAddress(body.email) : null
  const email = normalized ? normalized.toLowerCase() : null
  if (!email) return { ok: false, error: 'Enter a valid email address.' }
  const segment = body.segment === undefined || body.segment === '' ? 'general' : body.segment
  if (!isSegment(segment)) return { ok: false, error: 'Choose a newsletter.' }
  const role = newsletterRoleForSegment(segment)
  if (body.role !== undefined && !isRole(body.role)) return { ok: false, error: 'Choose a newsletter.' }
  if (isRole(body.role) && body.role !== role) return { ok: false, error: 'Choose a newsletter.' }
  if (!isCounty(body.county)) return { ok: false, error: 'Choose a county.' }
  if (body.consent !== true) return { ok: false, error: 'Consent is required before we save this signup.' }
  const source = typeof body.source === 'string' && SOURCE_PATTERN.test(body.source) ? body.source : 'funnel'
  return {
    ok: true,
    contact: {
      email,
      role,
      segment,
      county: body.county,
      tags: newsletterTags(role, body.county, segment),
      consent: {
        text: NEWSLETTER_CONSENT_TEXT,
        recordedAt: now.toISOString(),
        source,
      },
      status: 'subscribed',
    },
  }
}

export async function submitNewsletterSignup(
  input: unknown,
  store: NewsletterStore,
  now = new Date(),
): Promise<SignupResult> {
  const parsed = parseNewsletterSignup(input, now)
  if (!parsed.ok) return { httpStatus: 400, body: { ok: false, error: parsed.error }, stored: false }
  let suppressed: boolean | 'unknown'
  try {
    suppressed = await store.isSuppressed(parsed.contact.email)
  } catch {
    return { httpStatus: 503, body: { ok: false, error: 'Signup is not available yet. Nothing was saved.' }, stored: false }
  }
  if (suppressed === 'unknown') {
    return { httpStatus: 503, body: { ok: false, error: 'Signup is not available yet. Nothing was saved.' }, stored: false }
  }
  const received = { ok: true as const, status: 'received' as const, message: NEWSLETTER_SIGNUP_SUCCESS }
  if (suppressed) return { httpStatus: 200, body: received, stored: false }
  try {
    const saved = await store.save(parsed.contact)
    return { httpStatus: 200, body: received, stored: saved === 'saved' }
  } catch {
    return { httpStatus: 503, body: { ok: false, error: 'Signup is not available yet. Nothing was saved.' }, stored: false }
  }
}
