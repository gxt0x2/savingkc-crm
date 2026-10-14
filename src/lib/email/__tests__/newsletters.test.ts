import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { TAX_OUTREACH_FROM, decideHostedFrom } from '../providers/hosted-policy'
import {
  BUYER_STORY_PLACEHOLDER,
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_COUNTIES,
  SELLER_STORY_PLACEHOLDER,
} from '../newsletters/constants'
import { renderNewsletterIssue, renderNewsletterPreview } from '../newsletters/issue-one'
import { renderSignupFormPreview } from '../newsletters/signup-preview'
import { holdNewsletterDispatch, newsletterSchedules, ownerApprovalGranted } from '../newsletters/schedule'
import { submitNewsletterSignup, type NewsletterContact, type NewsletterStore } from '../newsletters/signup'
import { createNewsletterSignupHandler } from '../newsletters/signup-http'

const SANDBOX = 'savingkc@gmail.com'
const AMBER = /amber|#(?:f59e0b|fbbf24|d97706|fcd34d|b45309|ffbf00|ffa500)\b/i
const EM_DASH = /\u2014|\u2013/
const DEAL_CARD = /this week's house|deal card|<svg|EXAMPLE|Raytown/i

function memoryStore(seed?: { suppressed?: boolean; fail?: boolean }): NewsletterStore & { saved: NewsletterContact[] } {
  const saved: NewsletterContact[] = []
  return {
    saved,
    async isSuppressed() {
      if (seed?.fail) return 'unknown'
      return Boolean(seed?.suppressed)
    },
    async save(contact) {
      if (seed?.suppressed) return 'suppressed'
      saved.push(contact)
      return 'saved'
    },
  }
}

describe('Tuesday newsletter issue 1', () => {
  it('keeps the seller note personal, with the story placeholder and call link', () => {
    const issue = renderNewsletterIssue('tuesday_note')
    expect(issue.program).toBe('seller_nurture')
    expect(issue.fromMailbox).toBe('ernest@talktosavingkc.com')
    expect(issue.subject).toBe('The Tuesday Note #1: The county made a guess about your house')
    expect(issue.html).toContain(SELLER_STORY_PLACEHOLDER)
    expect(issue.html).toContain('https://savingkc.com/call')
    expect(issue.html).toContain('Saving KC Homebuyers')
    expect(issue.html).toContain('MO #2023026433')
    expect(issue.html).toContain('(816) 429-2900')
    expect(issue.html).toContain('>Unsubscribe</a>')
    expect(issue.headers['List-Unsubscribe']).toContain('/api/email/unsubscribe/')
    expect(issue.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(issue.html).not.toContain('INBOX PREVIEW')
    expect(issue.html).not.toMatch(EM_DASH)
    expect(issue.html).not.toMatch(AMBER)
    expect(issue.text).not.toMatch(EM_DASH)
  })

  it('keeps the buyer desk free of deal cards', () => {
    const issue = renderNewsletterIssue('tuesday_deal_desk')
    expect(issue.program).toBe('buyer_marketing')
    expect(issue.fromMailbox).toBe('ernest@talktosavingkc.com')
    expect(issue.subject.startsWith('The Tuesday Deal Desk #1:')).toBe(true)
    expect(issue.html).toContain(BUYER_STORY_PLACEHOLDER)
    expect(issue.html).toContain('Reply "LIST"')
    expect(issue.html).not.toMatch(DEAL_CARD)
    expect(issue.html).toContain('MO #2023026433')
    expect(issue.html).toContain('(816) 429-2900')
    expect(issue.html).toContain('>Unsubscribe</a>')
    expect(issue.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(issue.html).not.toMatch(EM_DASH)
    expect(issue.html).not.toMatch(AMBER)
  })

  it('leaves the seller outreach Ari pin and the savingkc.com ban alone', () => {
    expect(TAX_OUTREACH_FROM).toBe('ari@talktosavingkc.com')
    expect(decideHostedFrom({
      localPart: 'ernest',
      domain: 'talktosavingkc.com',
      program: 'seller_outreach',
      fromName: 'Ernest Dodson, Saving KC Homebuyers',
    })).toEqual({ ok: false, code: 'TAX_FROM_REQUIRED' })
    for (const program of ['seller_nurture', 'buyer_marketing', 'seller_outreach']) {
      expect(decideHostedFrom({
        localPart: 'ernest',
        domain: 'savingkc.com',
        program,
        fromName: 'Ernest',
      })).toEqual({ ok: false, code: 'FROM_DOMAIN_FORBIDDEN' })
    }
    expect(decideHostedFrom({
      localPart: 'ernest',
      domain: 'talktosavingkc.com',
      program: 'seller_nurture',
      fromName: 'Ernest Dodson, Saving KC Homebuyers',
    })).toEqual({ ok: true, mailbox: 'ernest@talktosavingkc.com' })
  })
})

describe('Tuesday newsletter schedule', () => {
  it('creates both editions disabled at Tuesday 07:00 America/Chicago', () => {
    const schedules = newsletterSchedules()
    expect(schedules).toHaveLength(2)
    for (const schedule of schedules) {
      expect(schedule).toMatchObject({
        weekday: 'tuesday',
        localTime: '07:00',
        timezone: 'America/Chicago',
        state: 'disabled',
        mode: 'draft_only',
        ownerApproved: false,
        fromMailbox: 'ernest@talktosavingkc.com',
      })
      expect(holdNewsletterDispatch({ ...schedule, ownerApprovalFlag: undefined }).reason).toBe('disabled')
      expect(holdNewsletterDispatch({ ...schedule, ownerApprovalFlag: 'approved' })).toMatchObject({
        action: 'hold',
        reason: 'disabled',
        sent: false,
        enrolled: false,
      })
    }
    expect(ownerApprovalGranted({})).toBe(false)
    expect(ownerApprovalGranted({ NEWSLETTER_OWNER_APPROVED: 'approved' })).toBe(true)
  })

  it('does not send when approval is missing, and does not send when the flag is present', () => {
    expect(holdNewsletterDispatch({
      state: 'draft',
      mode: 'draft_only',
      ownerApproved: false,
      ownerApprovalFlag: undefined,
    }).reason).toBe('owner_approval_required')
    expect(holdNewsletterDispatch({
      state: 'draft',
      mode: 'draft_only',
      ownerApproved: true,
      ownerApprovalFlag: 'approved',
    })).toMatchObject({ action: 'hold', reason: 'draft_only', sent: false, enrolled: false })
    expect(holdNewsletterDispatch({
      state: 'enabled',
      mode: 'live',
      ownerApproved: true,
      ownerApprovalFlag: 'approved',
      suppressed: true,
    }).reason).toBe('suppressed')
    expect(holdNewsletterDispatch({
      state: 'enabled',
      mode: 'live',
      ownerApproved: true,
      ownerApprovalFlag: 'approved',
    })).toMatchObject({ action: 'hold', reason: 'live_send_blocked', sent: false })
  })

  it('stores the same disabled rows in the migration and does not enroll', async () => {
    const migration = await readFile(
      new URL('../../../../supabase/migrations/20261126120000_email_newsletter_drafts.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain("'disabled', 'draft_only', false")
    expect(migration).toContain('ernest@talktosavingkc.com')
    expect(migration).toContain("'07:00'")
    expect(migration).toContain("'America/Chicago'")
    expect(migration).not.toMatch(/insert\s+into\s+public\.em_enrollments/i)
    expect(migration).not.toMatch(/insert\s+into\s+public\.em_send_intents/i)
  })
})

describe('newsletter signup', () => {
  it('stores the sandbox address with tags and consent', async () => {
    const store = memoryStore()
    const result = await submitNewsletterSignup({
      email: '  SavingKC@gmail.com ',
      role: 'seller',
      county: 'Jackson',
      consent: true,
      source: 'funnel',
    }, store, new Date('2026-10-14T12:00:00.000Z'))
    expect(result.stored).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(store.saved[0]).toMatchObject({
      email: SANDBOX,
      role: 'seller',
      county: 'Jackson',
      status: 'subscribed',
      tags: ['role:seller', 'edition:tuesday-note', 'county:jackson', 'source:newsletter-signup', 'consent:recorded'],
      consent: {
        text: NEWSLETTER_CONSENT_TEXT,
        recordedAt: '2026-10-14T12:00:00.000Z',
        source: 'funnel',
      },
    })
  })

  it('does not opt a suppressed sandbox address back in', async () => {
    const store = memoryStore({ suppressed: true })
    const result = await submitNewsletterSignup({
      email: SANDBOX,
      role: 'buyer',
      county: 'Johnson KS',
      consent: true,
      source: 'funnel',
    }, store)
    expect(result.stored).toBe(false)
    expect(result.httpStatus).toBe(200)
    expect(store.saved).toHaveLength(0)
  })

  it('rejects a signup without consent and fails closed when suppression cannot be read', async () => {
    const missingConsent = await submitNewsletterSignup({
      email: SANDBOX,
      role: 'buyer',
      county: 'Other',
      consent: false,
    }, memoryStore())
    expect(missingConsent.httpStatus).toBe(400)
    expect(missingConsent.stored).toBe(false)
    const unknown = await submitNewsletterSignup({
      email: SANDBOX,
      role: 'buyer',
      county: 'Clay',
      consent: true,
    }, memoryStore({ fail: true }))
    expect(unknown.httpStatus).toBe(503)
    expect(unknown.stored).toBe(false)
  })

  it('serves the public route without opening storage for an invalid body', async () => {
    let opened = false
    const handler = createNewsletterSignupHandler(() => {
      opened = true
      return memoryStore()
    })
    const response = await handler(new Request('https://crm.example.test/api/email/newsletters/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email', role: 'seller', county: 'Cass', consent: true }),
    }))
    expect(response.status).toBe(400)
    expect(opened).toBe(false)
    const saved = await handler(new Request('https://crm.example.test/api/email/newsletters/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SANDBOX, role: 'buyer', county: 'Wyandotte KS', consent: true, source: 'newsletters-page' }),
    }))
    expect(saved.status).toBe(200)
    expect(opened).toBe(true)
    const payload = await saved.json()
    expect(payload.ok).toBe(true)
    expect(payload).not.toHaveProperty('email')
  })

  it('fails closed when storage is not configured', async () => {
    const handler = createNewsletterSignupHandler(() => {
      throw new Error('EMAIL_HOSTED_SETUP_REQUIRED')
    })
    const response = await handler(new Request('https://crm.example.test/api/email/newsletters/signup', {
      method: 'POST',
      body: JSON.stringify({ email: SANDBOX, role: 'seller', county: 'Jackson', consent: true }),
    }))
    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload).toEqual({ ok: false, error: 'Signup is not available yet. Nothing was saved.' })
  })
})

describe('newsletter previews', () => {
  it('writes seller, buyer, and signup previews', async () => {
    const seller = renderNewsletterPreview('tuesday_note')
    const buyer = renderNewsletterPreview('tuesday_deal_desk')
    const form = renderSignupFormPreview()
    expect(seller.html).toContain('INBOX PREVIEW')
    expect(seller.html).toContain('List-Unsubscribe-Post')
    expect(buyer.html).not.toMatch(DEAL_CARD)
    expect(form).toContain('Send me the Tuesday note')
    for (const county of NEWSLETTER_COUNTIES) expect(form).toContain(county)
    expect(`${seller.html}\n${buyer.html}\n${form}`).not.toMatch(AMBER)
    expect(`${seller.html}\n${buyer.html}\n${form}`).not.toMatch(EM_DASH)
    const dir = '/opt/cursor/artifacts'
    await mkdir(dir, { recursive: true })
    await writeFile(`${dir}/tuesday-note-seller.html`, seller.html)
    await writeFile(`${dir}/tuesday-deal-desk-buyer.html`, buyer.html)
    await writeFile(`${dir}/newsletter-signup-form.html`, form)
  })
})
