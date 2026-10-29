import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  from: vi.fn(),
  downloadRecording: vi.fn(),
  transcribeAudio: vi.fn(),
  analyzeCallTranscript: vi.fn(),
  resolveLeadIdFromCallActivity: vi.fn(),
  resolveRecordingCallDirection: vi.fn(),
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
  resolveRecordingCallDirection: mocks.resolveRecordingCallDirection,
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
    mocks.resolveRecordingCallDirection.mockResolvedValue('inbound')
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

const VERIFICATION_TRANSCRIPTS = [
  'Press 1 to confirm this caller ID in the Mojo Dialer. Goodbye.',
  'Press 1 to confirm this caller ID in the Moto Dialer. Goodbye.',
  'Press 1 to confirm this caller ID in the middle of the. Goodbye.',
]
const SELLER_TRANSCRIPT = 'Hi, this is Maria. I want to sell my house at 123 Oak Street in Kansas City.'

function processedRecordingRequest(duration: string) {
  const form = new FormData()
  form.set('RecordingUrl', 'https://api.twilio.com/recordings/RE22222222222222222222222222222222')
  form.set('RecordingSid', 'RE22222222222222222222222222222222')
  form.set('RecordingStatus', 'completed')
  form.set('RecordingDuration', duration)
  form.set('CallSid', 'CA22222222222222222222222222222222')
  form.set('From', '+16037928544')
  form.set('To', '+18164292900')
  return new Request('https://crm.savingkc.com/api/twilio-recording-callback?leadId=lead-1&calledNumber=%2B18164292900', {
    method: 'POST',
    body: form,
  })
}

function recordingDb(lead: { classification: string | null; station: string; notes: string | null }) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  function chain(table: string) {
    let mode: 'select' | 'update' = 'select'
    const builder: Record<string, unknown> = {}
    const self = () => builder
    builder.select = vi.fn(self)
    builder.eq = vi.fn(self)
    builder.is = vi.fn(self)
    builder.contains = vi.fn(self)
    builder.limit = vi.fn(self)
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      inserts.push({ table, payload })
      return builder
    })
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      mode = 'update'
      updates.push({ table, payload })
      return builder
    })
    builder.maybeSingle = vi.fn(async () => {
      if (table === 'leads' && mode === 'select') {
        return { data: { id: 'lead-1', ...lead }, error: null }
      }
      if (table === 'leads' && mode === 'update') return { data: { id: 'lead-1' }, error: null }
      return { data: null, error: null }
    })
    builder.then = (
      resolve: (value: { data: null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: null, error: null }).then(resolve, reject)
    return builder
  }
  return { inserts, updates, from: (table: string) => chain(table) }
}

describe('caller ID verification recordings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.resolveRecordingCallDirection.mockResolvedValue('inbound')
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null })
    mocks.downloadRecording.mockResolvedValue('/tmp/recording.mp3')
    mocks.analyzeCallTranscript.mockResolvedValue({ summary: 'Seller wants an offer', aiSummary: 'Seller wants an offer' })
    mocks.completeDialerPostCallReview.mockResolvedValue(false)
    mocks.markDialerPostCallProcessing.mockResolvedValue(false)
    mocks.markDialerPostCallUnavailable.mockResolvedValue(false)
    mocks.createCallAnalysisLeadProposal.mockResolvedValue(null)
  })

  it.each(VERIFICATION_TRANSCRIPTS)('marks a verification robocall not a lead and keeps the call log: %s', async (transcript) => {
    const db = recordingDb({
      classification: null,
      station: 'new',
      notes: 'Connected inbound call to (816) 429-2900.',
    })
    mocks.from.mockImplementation(db.from)
    mocks.transcribeAudio.mockResolvedValue(transcript)

    const response = await POST(processedRecordingRequest('7'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, leadId: 'lead-1', processed: true })
    expect(mocks.analyzeCallTranscript).not.toHaveBeenCalled()
    expect(mocks.createCallAnalysisLeadProposal).not.toHaveBeenCalled()
    expect(mocks.markDialerPostCallUnavailable).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'caller_id_verification',
      status: 'skipped',
    }))
    expect(db.inserts.map((row) => row.payload.description)).toEqual(expect.arrayContaining([
      'Call recording available',
      expect.stringContaining('Call transcript:'),
      'Marked not a lead — caller ID verification robocall',
    ]))
    expect(db.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'leads',
        payload: expect.objectContaining({
          classification: 'dead',
          station: 'dead',
          priority: 'cold',
          dead_reason: 'spam_vendor_duplicate',
          dead_by: 'system:caller_id_verification',
        }),
      }),
    ]))
    expect(db.updates.some((row) => row.table === 'leads' && row.payload.transcript === transcript)).toBe(true)
  })

  it('keeps a normal seller call as a lead and still analyzes it', async () => {
    const db = recordingDb({ classification: null, station: 'new', notes: null })
    mocks.from.mockImplementation(db.from)
    mocks.transcribeAudio.mockResolvedValue(SELLER_TRANSCRIPT)

    const response = await POST(processedRecordingRequest('42'))

    expect(response.status).toBe(200)
    expect(mocks.analyzeCallTranscript).toHaveBeenCalledWith(SELLER_TRANSCRIPT)
    expect(mocks.createCallAnalysisLeadProposal).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      analysis: expect.objectContaining({ summary: 'Seller wants an offer' }),
    }))
    expect(mocks.completeDialerPostCallReview).toHaveBeenCalled()
    expect(db.inserts.map((row) => row.payload.description)).toEqual(expect.arrayContaining([
      'Call recording available',
      expect.stringContaining('Call transcript:'),
      expect.stringContaining('AI Call Analysis:'),
    ]))
    expect(db.updates.some((row) => row.payload.classification === 'dead')).toBe(false)
    expect(db.inserts.some((row) => row.payload.description === 'Marked not a lead — caller ID verification robocall')).toBe(false)
  })

  it('does not retire a seller who was already confirmed when a short verification clip is attached', async () => {
    const db = recordingDb({ classification: 'lead', station: 'contacted', notes: 'Seller confirmed.' })
    mocks.from.mockImplementation(db.from)
    mocks.transcribeAudio.mockResolvedValue(VERIFICATION_TRANSCRIPTS[0])

    await POST(processedRecordingRequest('6'))

    expect(mocks.analyzeCallTranscript).not.toHaveBeenCalled()
    expect(db.updates.some((row) => row.payload.classification === 'dead')).toBe(false)
    expect(db.inserts.some((row) => String(row.payload.description).startsWith('Call transcript:'))).toBe(true)
  })
})
