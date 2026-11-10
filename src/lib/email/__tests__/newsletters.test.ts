import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { TAX_OUTREACH_FROM, decideHostedFrom } from '../providers/hosted-policy'
import {
  GENERAL_STORY_PLACEHOLDER,
  INHERITED_STORY_PLACEHOLDER,
  INVESTOR_STORY_PLACEHOLDER,
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_COUNTIES,
  NEWSLETTER_SEGMENTS,
  TAX_STORY_PLACEHOLDER,
  type NewsletterSegment,
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
const BRAND_LLC = /Saving KC Homebuyers LLC/

const MARKERS: Record<NewsletterSegment, string> = {
  general: 'mortgage payoff',
  tax: 'fourth Monday in August',
  inherited: 'personal representative',
  investor: "Freddie Mac's 30-year average",
}

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
  it('renders four distinct segment issues with one call CTA and no sendable inbox card', () => {
    const issues = NEWSLETTER_SEGMENTS.map((segment) => renderNewsletterIssue(segment))
    expect(new Set(issues.map((issue) => issue.subject)).size).toBe(4)
    expect(new Set(issues.map((issue) => issue.html)).size).toBe(4)
    for (const issue of issues) {
      expect(issue.fromMailbox).toBe('ernest@talktosavingkc.com')
      expect(issue.html).not.toMatch(/@savingkc\.com\b/)
      expect(issue.html).toContain('https://savingkc.com/call')
      expect(issue.html.match(/https:\/\/savingkc\.com\/call/g)).toHaveLength(1)
      expect(issue.html).toContain('[ERNEST STORY')
      expect(issue.html).toContain('Saving KC Homebuyers')
      expect(issue.html).not.toMatch(BRAND_LLC)
      expect(issue.html).toContain('Platinum Realty LLC')
      expect(issue.html).toContain('MO #2023026433')
      expect(issue.html).toContain('(816) 429-2900')
      expect(issue.html).toContain('>Unsubscribe</a>')
      expect(issue.text.match(/\?/g)).toHaveLength(1)
      expect(issue.headers['List-Unsubscribe']).toContain('/api/email/unsubscribe/')
      expect(issue.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
      expect(issue.html).not.toContain('INBOX PREVIEW')
      expect(issue.html).not.toMatch(EM_DASH)
      expect(issue.html).not.toMatch(AMBER)
      expect(issue.text).not.toMatch(EM_DASH)
      expect(issue.html).not.toMatch(DEAL_CARD)
      expect(issue.html).not.toContain('(816) 608-8588')
      expect(issue.html).toContain(MARKERS[issue.segment])
      for (const other of NEWSLETTER_SEGMENTS) {
        if (other !== issue.segment) expect(issue.html).not.toContain(MARKERS[other])
      }
    }
  })

  it('speaks to each segment in its own voice', () => {
    const general = renderNewsletterIssue('general')
    const tax = renderNewsletterIssue('tax')
    const inherited = renderNewsletterIssue('inherited')
    const investor = renderNewsletterIssue('investor')

    expect(general.program).toBe('seller_nurture')
    expect(general.edition).toBe('tuesday_note_general')
    expect(general.subject).toBe('The Tuesday Note #1: You do not have to decide today')
    expect(general.html).toContain(GENERAL_STORY_PLACEHOLDER)
    expect(general.html).toContain('It feels like looking at the house')
    expect(general.html).toContain('including staying put')

    expect(tax.program).toBe('seller_nurture')
    expect(tax.edition).toBe('tuesday_note_tax')
    expect(tax.subject).toBe('The Tuesday Note #1: The bill on the counter')
    expect(tax.html).toContain(TAX_STORY_PLACEHOLDER)
    expect(tax.html).toContain('It feels like the county already decided')
    expect(tax.html).toContain('(816) 881-3232')
    expect(tax.html).toContain('August 2026 Jackson County sale was canceled')
    expect(tax.html).toContain('clear the taxes at closing')

    expect(inherited.program).toBe('seller_nurture')
    expect(inherited.edition).toBe('tuesday_note_inherited')
    expect(inherited.subject).toBe('The Tuesday Note #1: A house you did not ask for')
    expect(inherited.html).toContain(INHERITED_STORY_PLACEHOLDER)
    expect(inherited.html).toContain('It feels like everyone else has an opinion')
    expect(inherited.html).toContain('probate and clean-out stress')
    expect(inherited.html).toContain("I'm not your lawyer")

    expect(investor.program).toBe('buyer_marketing')
    expect(investor.edition).toBe('tuesday_deal_desk')
    expect(investor.subject.startsWith('The Tuesday Deal Desk #1:')).toBe(true)
    expect(investor.html).toContain(INVESTOR_STORY_PLACEHOLDER)
    expect(investor.html).toContain('It feels like the same house got more expensive')
    expect(investor.html).toContain('7.40%')
    expect(investor.html).toContain('first look')
    expect(investor.html).not.toContain('Reply "LIST"')
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
  it('creates four disabled segment rows at Tuesday 07:00 America/Chicago', () => {
    const schedules = newsletterSchedules()
    expect(schedules.map((schedule) => schedule.segment)).toEqual(['general', 'tax', 'inherited', 'investor'])
    for (const schedule of schedules) {
      expect(schedule).toMatchObject({
        weekday: 'tuesday',
        localTime: '07:00',
        timezone: 'America/Chicago',
        state: 'disabled',
        mode: 'draft_only',
        ownerApproved: false,
        fromMailbox: 'ernest@talktosavingkc.com',
        program: schedule.segment === 'investor' ? 'buyer_marketing' : 'seller_nurture',
      })
      expect(holdNewsletterDispatch({ ...schedule, ownerApprovalFlag: undefined }).reason).toBe('disabled')
      expect(holdNewsletterDispatch({ ...schedule, ownerApprovalFlag: 'approved' })).toMatchObject({
        action: 'hold',
        reason: 'disabled',
        sent: false,
        enrolled: false,
      })
    }
    expect(ownerApprovalGranted({} as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(ownerApprovalGranted({ NEWSLETTER_OWNER_APPROVED: 'approved' } as unknown as NodeJS.ProcessEnv)).toBe(true)
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

  it('replaces the two schedules with four disabled segment rows', async () => {
    const migration = await readFile(
      new URL('../../../../supabase/migrations/20261126130000_email_newsletter_segments.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain("DEFAULT 'general'")
    expect(migration).toContain("CHECK (segment IN ('general', 'tax', 'inherited', 'investor'))")
    expect(migration).toContain("'tuesday_note_general', 'seller_nurture'")
    expect(migration).toContain("'tuesday_note_tax', 'seller_nurture'")
    expect(migration).toContain("'tuesday_note_inherited', 'seller_nurture'")
    expect(migration).toContain("'tuesday_deal_desk', 'buyer_marketing'")
    expect(migration).toContain('ernest@talktosavingkc.com')
    expect(migration).toContain("'disabled'")
    expect(migration).toContain("'draft_only'")
    expect(migration).toContain('owner_approved = false')
    expect(migration).not.toMatch(/insert\s+into\s+public\.em_enrollments/i)
    expect(migration).not.toMatch(/insert\s+into\s+public\.em_send_intents/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    const persist = await readFile(new URL('../newsletters/persist.ts', import.meta.url), 'utf8')
    expect(persist).toContain('segment')
  })
})

describe('newsletter signup', () => {
  it('stores the sandbox address with the default general segment, tags, and consent', async () => {
    const store = memoryStore()
    const result = await submitNewsletterSignup({
      email: '  SavingKC@gmail.com ',
      county: 'Jackson',
      consent: true,
      source: 'funnel',
    }, store, new Date('2026-10-14T12:00:00.000Z'))
    expect(result.stored).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(store.saved[0]).toMatchObject({
      email: SANDBOX,
      role: 'seller',
      segment: 'general',
      county: 'Jackson',
      status: 'subscribed',
      tags: ['role:seller', 'segment:general', 'edition:tuesday-note-general', 'county:jackson', 'source:newsletter-signup', 'consent:recorded'],
      consent: {
        text: NEWSLETTER_CONSENT_TEXT,
        recordedAt: '2026-10-14T12:00:00.000Z',
        source: 'funnel',
      },
    })
  })

  it('stores a chosen tax or investor segment and derives the role', async () => {
    const taxStore = memoryStore()
    await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'tax',
      county: 'Jackson',
      consent: true,
      source: 'funnel',
    }, taxStore)
    expect(taxStore.saved[0]).toMatchObject({ role: 'seller', segment: 'tax' })
    expect(taxStore.saved[0]?.tags).toContain('segment:tax')

    const investorStore = memoryStore()
    await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'investor',
      county: 'Johnson KS',
      consent: true,
      source: 'newsletters-page',
    }, investorStore)
    expect(investorStore.saved[0]).toMatchObject({
      role: 'buyer',
      segment: 'investor',
      tags: ['role:buyer', 'segment:investor', 'edition:tuesday-deal-desk', 'county:johnson-ks', 'source:newsletter-signup', 'consent:recorded'],
    })
  })

  it('does not opt a suppressed sandbox address back in', async () => {
    const store = memoryStore({ suppressed: true })
    const result = await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'investor',
      county: 'Johnson KS',
      consent: true,
      source: 'funnel',
    }, store)
    expect(result.stored).toBe(false)
    expect(result.httpStatus).toBe(200)
    expect(store.saved).toHaveLength(0)
  })

  it('rejects a bad segment, a role that fights the segment, and a signup without consent', async () => {
    const badSegment = await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'landlord',
      county: 'Clay',
      consent: true,
    }, memoryStore())
    expect(badSegment.httpStatus).toBe(400)
    expect(badSegment.stored).toBe(false)

    const mismatch = await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'investor',
      role: 'seller',
      county: 'Clay',
      consent: true,
    }, memoryStore())
    expect(mismatch.httpStatus).toBe(400)

    const missingConsent = await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'inherited',
      county: 'Other',
      consent: false,
    }, memoryStore())
    expect(missingConsent.httpStatus).toBe(400)
    expect(missingConsent.stored).toBe(false)

    const unknown = await submitNewsletterSignup({
      email: SANDBOX,
      segment: 'general',
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
      body: JSON.stringify({ email: 'not-an-email', segment: 'general', county: 'Cass', consent: true }),
    }))
    expect(response.status).toBe(400)
    expect(opened).toBe(false)
    const saved = await handler(new Request('https://crm.example.test/api/email/newsletters/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SANDBOX, segment: 'inherited', county: 'Wyandotte KS', consent: true, source: 'newsletters-page' }),
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
      body: JSON.stringify({ email: SANDBOX, segment: 'tax', county: 'Jackson', consent: true }),
    }))
    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload).toEqual({ ok: false, error: 'Signup is not available yet. Nothing was saved.' })
  })
})

describe('newsletter previews', () => {
  it('writes the four issue previews and the signup form', async () => {
    const previews = {
      general: renderNewsletterPreview('general'),
      tax: renderNewsletterPreview('tax'),
      inherited: renderNewsletterPreview('inherited'),
      investor: renderNewsletterPreview('investor'),
    }
    const form = renderSignupFormPreview()
    expect(previews.general.html).toContain('INBOX PREVIEW')
    expect(previews.general.html).toContain('ernest@talktosavingkc.com')
    expect(previews.investor.html).not.toMatch(DEAL_CARD)
    expect(form).toContain('Send me the Tuesday note')
    expect(form).toContain('value="general" checked')
    expect(form).toContain('value="tax"')
    expect(form).toContain('value="inherited"')
    expect(form).toContain('value="investor"')
    for (const county of NEWSLETTER_COUNTIES) expect(form).toContain(county)
    const combined = `${Object.values(previews).map((issue) => issue.html).join('\n')}\n${form}`
    expect(combined).not.toMatch(AMBER)
    expect(combined).not.toMatch(EM_DASH)
    expect(combined).not.toMatch(BRAND_LLC)
    const dir = '/opt/cursor/artifacts'
    await mkdir(dir, { recursive: true })
    await writeFile(`${dir}/newsletter-general.html`, previews.general.html)
    await writeFile(`${dir}/newsletter-tax.html`, previews.tax.html)
    await writeFile(`${dir}/newsletter-inherited.html`, previews.inherited.html)
    await writeFile(`${dir}/newsletter-investor.html`, previews.investor.html)
    await writeFile(`${dir}/signup-preview.html`, form)
  })
})
