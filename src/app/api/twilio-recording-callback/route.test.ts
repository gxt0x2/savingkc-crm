import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  from: vi.fn(),
  downloadRecording: vi.fn(),
  transcribeAudio: vi.fn(),
  analyzeCallTranscript: vi.fn(),
  resolveLeadIdFromCallActivity: vi.fn(),
  resolveGoogleAdsLeadContext: vi.fn(),
  markLeadAsGoogleAdsPhoneLead: vi.fn(),
  upsertAppointmentFromCall: vi.fn(),
  syncCoOwners: vi.fn(),
  completeDialerPostCallReview: vi.fn(),
  markDialerPostCallProcessing: vi.fn(),
  markDialerPostCallUnavailable: vi.fn(),
  createCallAnalysisLeadProposal: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/mojo-recording-downloader', () => ({
  downloadRecording: mocks.downloadRecording,
}))

vi.mock('@/lib/mojo-transcriber', () => ({
  transcribeAudio: mocks.transcribeAudio,
}))

vi.mock('@/lib/mojo-call-analyzer', () => ({
  analyzeCallTranscript: mocks.analyzeCallTranscript,
}))

vi.mock('@/lib/internal-test-phones', () => ({
  isInternalTestPhone: vi.fn(() => false),
}))

vi.mock('@/lib/appointments', () => ({
  upsertAppointmentFromCall: mocks.upsertAppointmentFromCall,
}))

vi.mock('@/lib/co-owners', () => ({
  syncCoOwners: mocks.syncCoOwners,
}))

vi.mock('@/lib/server/dialer-post-call-review', () => ({
  completeDialerPostCallReview: mocks.completeDialerPostCallReview,
  markDialerPostCallProcessing: mocks.markDialerPostCallProcessing,
  markDialerPostCallUnavailable: mocks.markDialerPostCallUnavailable,
}))
vi.mock('@/lib/server/ai-change-proposals', () => ({
  createCallAnalysisLeadProposal: mocks.createCallAnalysisLeadProposal,
}))

vi.mock('@/lib/call-quality-events', () => ({
  GOOGLE_ADS_CAMPAIGN: 'Search 2026',
  GOOGLE_ADS_PHONE_SOURCE: 'google_ads_phone',
  GOOGLE_ADS_TAX_PHONE_SOURCE: 'google_ads_tax_phone',
  PPC_TRACKING_PHONE_DIGITS: '18160000000',
  getGoogleAdsPhoneProfile: vi.fn(() => ({
    campaign: 'Search 2026',
    source: 'google_ads_phone',
    trackingDigits: '18160000000',
    landingPage: '/ppc',
    key: 'seller',
  })),
  isPpcTrackingNumber: vi.fn(() => false),
}))

vi.mock('@/lib/google-ads-phone', () => ({
  markLeadAsGoogleAdsPhoneLead: mocks.markLeadAsGoogleAdsPhoneLead,
  phoneLookupVariants: (phone: string) => [phone],
  resolveGoogleAdsLeadContext: mocks.resolveGoogleAdsLeadContext,
}))

vi.mock('@/lib/telephony/recording-lead-resolution', () => ({
  resolveLeadIdFromCallActivity: mocks.resolveLeadIdFromCallActivity,
}))

vi.mock('twilio', () => ({
  default: vi.fn(),
}))

import { POST } from './route'

function chain(result: { data: unknown; error: unknown }) {
  const value: Record<string, unknown> = {}
  value.select = vi.fn(() => value)
  value.eq = vi.fn(() => value)
  value.contains = vi.fn(() => value)
  value.limit = vi.fn(() => value)
  value.maybeSingle = vi.fn(async () => result)
  value.update = vi.fn(() => value)
  return value
}

function recordingRequest() {
  const form = new FormData()
  form.set('RecordingUrl', 'https://api.twilio.com/recordings/RE11111111111111111111111111111111')
  form.set('RecordingSid', 'RE11111111111111111111111111111111')
  form.set('RecordingStatus', 'completed')
  form.set('RecordingDuration', '60')
  form.set('CallSid', 'CA11111111111111111111111111111111')
  form.set('From', '+19135550123')
  form.set('To', '+18163077835')
  return new Request('https://crm.savingkc.com/api/twilio-recording-callback?leadId=lead-1', {
    method: 'POST',
    body: form,
  })
}

describe('Twilio recording callback containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null })
    mocks.completeDialerPostCallReview.mockResolvedValue(false)
    mocks.markDialerPostCallProcessing.mockResolvedValue(false)
    mocks.markDialerPostCallUnavailable.mockResolvedValue(false)
    mocks.createCallAnalysisLeadProposal.mockResolvedValue(null)
  })

  it('rejects an invalid signature before reading CRM data or media', async () => {
    mocks.validateTwilioWebhook.mockResolvedValue(false)

    const response = await POST(recordingRequest())

    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.downloadRecording).not.toHaveBeenCalled()
  })

  it('acknowledges a completed retry without downloading or analyzing again', async () => {
    const leads = chain({ data: { id: 'lead-1' }, error: null })
    const activities = chain({
      data: {
        id: 'activity-1',
        metadata: {
          recordingSid: 'RE11111111111111111111111111111111',
          recordingProcessingState: 'completed',
        },
      },
      error: null,
    })
    mocks.from.mockImplementation((table: string) => table === 'leads' ? leads : activities)

    const response = await POST(recordingRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      leadId: 'lead-1',
      processed: false,
      skipped: 'duplicate_completed',
    })
    expect(mocks.downloadRecording).not.toHaveBeenCalled()
    expect(mocks.transcribeAudio).not.toHaveBeenCalled()
    expect(mocks.analyzeCallTranscript).not.toHaveBeenCalled()
  })

  it('marks a linked durable attempt skipped when the provider recording is too short', async () => {
    const request = recordingRequest()
    const url = new URL(request.url)
    url.searchParams.set('clientAttemptId', 'attempt-1')
    const shortBody = await request.formData()
    shortBody.set('RecordingDuration', '4')

    const response = await POST(new Request(url, { method: 'POST', body: shortBody }))

    expect(response.status).toBe(200)
    expect(mocks.markDialerPostCallUnavailable).toHaveBeenCalledWith(expect.objectContaining({
      clientAttemptId: 'attempt-1',
      providerCallSid: 'CA11111111111111111111111111111111',
      recordingSid: 'RE11111111111111111111111111111111',
      status: 'skipped',
      failureCode: 'recording_too_short',
    }))
    expect(mocks.downloadRecording).not.toHaveBeenCalled()
  })
})
