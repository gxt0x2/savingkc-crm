import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  enqueuePpcConversion: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/call-quality-events', () => ({
  getGoogleAdsPhoneProfile: vi.fn(() => ({
    campaign: 'Search 2026',
    trackingDigits: '18160000000',
    source: 'google_ads_phone',
    landingPage: '/ppc',
    key: 'seller',
  })),
  getGoogleAdsCallQualityMilestones: vi.fn(() => []),
  getCallQualityMilestones: vi.fn(() => []),
  isPpcTrackingNumber: vi.fn(() => false),
  parseCallDurationSeconds: vi.fn((value: FormDataEntryValue | null) => Number(value || 0)),
}))

vi.mock('@/lib/google-ads-phone', () => ({
  phoneLookupVariants: (phone: string) => [phone],
}))

vi.mock('@/lib/internal-test-phones', () => ({
  isInternalTestPhone: vi.fn(() => false),
}))

vi.mock('@/lib/ppc/conversion-outbox', () => ({
  enqueuePpcConversion: mocks.enqueuePpcConversion,
}))

import { POST } from './route'

type DbState = {
  existingCallback?: { id: string; lead_id: string | null } | null
  insertError?: { code: string } | null
}

function database(state: DbState = {}) {
  const inserts: unknown[] = []
  const leadActivities: Record<string, unknown> = {}
  leadActivities.select = vi.fn(() => leadActivities)
  leadActivities.eq = vi.fn(() => leadActivities)
  leadActivities.limit = vi.fn(() => leadActivities)
  leadActivities.maybeSingle = vi.fn(async () => ({
    data: state.existingCallback ?? null,
    error: null,
  }))
  leadActivities.insert = vi.fn(async (payload: unknown) => {
    inserts.push(payload)
    return { data: null, error: state.insertError ?? null }
  })

  const leads: Record<string, unknown> = {}
  leads.select = vi.fn(() => leads)
  leads.eq = vi.fn(() => leads)
  leads.order = vi.fn(() => leads)
  leads.limit = vi.fn(() => leads)
  leads.maybeSingle = vi.fn(async () => ({ data: { id: 'lead-1' }, error: null }))

  return {
    client: {
      from: vi.fn((table: string) => table === 'lead_activities' ? leadActivities : leads),
    },
    inserts,
  }
}

function statusRequest(status = 'failed') {
  const form = new FormData()
  form.set('CallSid', 'CA11111111111111111111111111111111')
  form.set('ParentCallSid', 'CA22222222222222222222222222222222')
  form.set('CallStatus', status)
  form.set('From', '+18163077835')
  form.set('To', '+19135550123')
  form.set('CallDuration', '0')
  return new Request('https://crm.savingkc.com/api/twilio-call-status?identity=ernest', {
    method: 'POST',
    body: form,
  })
}

describe('Twilio call status callback containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
  })

  it('rejects an invalid signature before touching the database', async () => {
    mocks.validateTwilioWebhook.mockResolvedValue(false)

    const response = await POST(statusRequest())

    expect(response.status).toBe(403)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('does not insert a second activity for an already persisted callback', async () => {
    const db = database({ existingCallback: { id: 'activity-1', lead_id: 'lead-1' } })
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, duplicate: true, callStatus: 'failed' })
    expect(db.inserts).toHaveLength(0)
  })

  it('treats a deterministic primary-key race as a successful duplicate retry', async () => {
    const db = database({ existingCallback: null, insertError: { code: '23505' } })
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.duplicate).toBe(true)
    expect(db.inserts).toHaveLength(1)
  })
})
