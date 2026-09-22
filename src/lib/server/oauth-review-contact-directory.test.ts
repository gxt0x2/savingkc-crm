import { describe, expect, it } from 'vitest'
import { OAUTH_REVIEW_SANDBOX_LEAD_ID } from '@/lib/auth/oauth-review-sandbox'
import { buildOauthReviewContactDirectoryPage } from './oauth-review-contact-directory'
import type { ContactDirectoryQuery } from './contact-directory-read-model'

const query = (overrides: Partial<ContactDirectoryQuery> = {}): ContactDirectoryQuery => ({
  smartList: 'contacted',
  scope: 'active',
  limit: 25,
  cursor: null,
  sort: 'recent',
  search: '',
  owner: '',
  stage: '',
  minimumStage: '',
  source: '',
  tag: '',
  activity: '',
  attention: '',
  outreach: '',
  dataGap: '',
  referenceTime: '2026-09-22T15:00:00.000Z',
  ...overrides,
})

const sandboxLead = {
  id: OAUTH_REVIEW_SANDBOX_LEAD_ID,
  full_name: 'OAuth Demo — Ernest Dodson',
  phone: '9137179716',
  email: 'savingkc@gmail.com',
  property_address: '1 Demo St',
  city: 'Kansas City',
  source: 'manual',
  station: 'appointment_set',
  classification: 'opportunity',
  dead_reason: null,
  assigned_agent: 'OAuth Review (throwaway)',
  opportunity_score: 10,
  is_favorite: false,
  created_at: '2026-09-22T14:00:00.000Z',
  updated_at: '2026-09-22T14:30:00.000Z',
  is_parked: false,
}

describe('oauth review contact directory', () => {
  it('shows the sandbox opportunity on Appointment Set and All, and hides it from Leads', () => {
    const appointmentSet = buildOauthReviewContactDirectoryPage({
      lead: sandboxLead,
      thread: null,
      activity: null,
      entityAuthority: 'lead_compatibility',
      query: query({ smartList: 'appointment_set' }),
    })
    const all = buildOauthReviewContactDirectoryPage({
      lead: sandboxLead,
      thread: null,
      activity: null,
      entityAuthority: 'lead_compatibility',
      query: query({ smartList: 'all' }),
    })
    const leads = buildOauthReviewContactDirectoryPage({
      lead: sandboxLead,
      thread: null,
      activity: null,
      entityAuthority: 'lead_compatibility',
      query: query({ smartList: 'contacted' }),
    })

    expect(appointmentSet.items.map((item) => item.id)).toEqual([OAUTH_REVIEW_SANDBOX_LEAD_ID])
    expect(appointmentSet.totalCount).toBe(1)
    expect(appointmentSet.scopeCounts).toEqual({ active: 1, prospects: 0, not_leads: 0 })
    expect(all.items).toHaveLength(1)
    expect(leads.items.map((item) => item.id)).toEqual([OAUTH_REVIEW_SANDBOX_LEAD_ID])
    expect(leads.smartListCounts.appointment_set).toBe(1)
    expect(leads.smartListCounts.contacted).toBe(1)
    expect(leads.smartListCounts.prospects).toBe(0)
    const prospects = buildOauthReviewContactDirectoryPage({
      lead: sandboxLead,
      thread: null,
      activity: null,
      entityAuthority: 'lead_compatibility',
      query: query({ smartList: 'prospects', scope: 'prospects' }),
    })
    expect(prospects.items).toEqual([])
  })

  it('drops the sandbox lead when search does not match it', () => {
    const page = buildOauthReviewContactDirectoryPage({
      lead: sandboxLead,
      thread: null,
      activity: null,
      entityAuthority: 'lead_compatibility',
      query: query({ smartList: 'all', search: 'unrelated seller' }),
    })
    expect(page.items).toEqual([])
    expect(page.totalCount).toBe(0)
  })
})
