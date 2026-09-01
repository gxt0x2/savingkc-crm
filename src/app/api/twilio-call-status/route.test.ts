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
  providerResult?: { recorded: boolean } | null
  providerError?: { message: string } | null
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
      rpc: vi.fn(async () => ({
        data: state.providerResult ?? { recorded: true },
        error: state.providerError ?? null,
      })),
      from: vi.fn((table: string) => table === 'lead_activities' ? leadActivities : leads),
    },
    inserts,
  }
}

function statusRequest(status = 'failed', clientAttemptId?: string) {
  const form = new FormData()
  form.set('CallSid', 'CA11111111111111111111111111111111')
  form.set('ParentCallSid', 'CA22222222222222222222222222222222')
  form.set('CallStatus', status)
  form.set('From', '+18163077835')
  form.set('To', '+19135550123')
  form.set('CallDuration', '0')
  const url = new URL('https://crm.savingkc.com/api/twilio-call-status?identity=ernest')
  if (clientAttemptId) url.searchParams.set('clientAttemptId', clientAttemptId)
  return new Request(url, {
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

  it('records signed provider evidence for a non-terminal durable attempt', async () => {
    const db = database()
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest('initiated', 'attempt-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      skipped: 'non_terminal',
      callStatus: 'initiated',
      providerRecorded: true,
    })
    expect(db.client.rpc).toHaveBeenCalledWith('record_dialer_attempt_provider_status_v1', {
      p_client_attempt_id: 'attempt-1',
      p_provider_call_sid: 'CA11111111111111111111111111111111',
      p_provider_status: 'initiated',
      p_duration_seconds: 0,
    })
    expect(db.inserts).toHaveLength(0)
  })

  it('records the answered provider state before returning the callback', async () => {
    const db = database()
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest('answered', 'attempt-answered'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      skipped: 'non_terminal',
      callStatus: 'answered',
      providerRecorded: true,
    })
    expect(db.client.rpc).toHaveBeenCalledWith('record_dialer_attempt_provider_status_v1', expect.objectContaining({
      p_client_attempt_id: 'attempt-answered',
      p_provider_status: 'answered',
    }))
  })

  it('records terminal provider state before persisting the diagnostic activity', async () => {
    const db = database()
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest('completed', 'attempt-completed'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      callStatus: 'completed',
      providerRecorded: true,
    })
    expect(db.client.rpc).toHaveBeenCalledWith('record_dialer_attempt_provider_status_v1', expect.objectContaining({
      p_client_attempt_id: 'attempt-completed',
      p_provider_status: 'completed',
    }))
    expect(db.inserts).toHaveLength(1)
  })

  it('treats a signed callback for a missing durable attempt as an idempotent no-op', async () => {
    const db = database({ providerResult: { recorded: false } })
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest('initiated', 'missing-attempt'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      skipped: 'non_terminal',
      providerRecorded: false,
    })
    expect(db.client.rpc).toHaveBeenCalledTimes(1)
    expect(db.inserts).toHaveLength(0)
  })

  it('fails for retry when durable provider evidence cannot be recorded', async () => {
    const db = database({ providerError: { message: 'database unavailable' } })
    mocks.createClient.mockReturnValue(db.client)

    const response = await POST(statusRequest('ringing', 'attempt-1'))

    expect(response.status).toBe(500)
    expect(db.inserts).toHaveLength(0)
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
