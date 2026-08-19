import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  from: vi.fn(),
  sendTeamLeadAlert: vi.fn(),
  downloadRecording: vi.fn(),
  transcribeAudio: vi.fn(),
  analyzeCallTranscript: vi.fn(),
  ensureManifestExists: vi.fn(),
  updateManifestV2_1: vi.fn(),
  resolveGoogleAdsLeadContext: vi.fn(),
  notifyGoogleAdsTeam: vi.fn(),
  safeSendSMS: vi.fn(),
  isOptedOut: vi.fn(),
  isDuplicateSms: vi.fn(),
  logSmsSend: vi.fn(),
  phoneRateLimit: vi.fn(),
  getAgentRouting: vi.fn(),
  getGoogleAdsPhoneProfile: vi.fn(),
  getLeadAlertRecipients: vi.fn(),
  lookupProspectByPhone: vi.fn(),
  createEnrichedLeadFromProspect: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/lead-team-alerts', () => ({
  sendTeamLeadAlert: mocks.sendTeamLeadAlert,
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

vi.mock('@/lib/manifest-sync', () => ({
  ensureManifestExists: mocks.ensureManifestExists,
  updateManifestV2_1: mocks.updateManifestV2_1,
}))

vi.mock('@/lib/google-ads-phone', () => ({
  googleAdsNewCallTeamMessage: vi.fn(() => 'New Google Ads call'),
  notifyGoogleAdsTeam: mocks.notifyGoogleAdsTeam,
  resolveGoogleAdsLeadContext: mocks.resolveGoogleAdsLeadContext,
}))

vi.mock('@/lib/agent-routing', () => ({
  getAgentRouting: mocks.getAgentRouting,
}))

vi.mock('@/lib/call-quality-events', () => ({
  GOOGLE_ADS_PHONE_NUMBER: '+18166088808',
  getGoogleAdsPhoneProfile: mocks.getGoogleAdsPhoneProfile,
}))

vi.mock('@/lib/lead-alert-routing', () => ({
  getLeadAlertRecipients: mocks.getLeadAlertRecipients,
}))

vi.mock('@/lib/prospect-lookup', () => ({
  lookupProspectByPhone: mocks.lookupProspectByPhone,
}))

vi.mock('@/lib/prospect-to-lead', () => ({
  createEnrichedLeadFromProspect: mocks.createEnrichedLeadFromProspect,
}))

vi.mock('@/lib/sms-opt-out', () => ({
  isOptedOut: mocks.isOptedOut,
}))

vi.mock('@/lib/sms-dedup', () => ({
  isDuplicateSms: mocks.isDuplicateSms,
  logSmsSend: mocks.logSmsSend,
}))

vi.mock('@/middleware/rate-limit', () => ({
  phoneRateLimit: mocks.phoneRateLimit,
}))

vi.mock('@/lib/safe-communications', () => ({
  safeSendSMS: mocks.safeSendSMS,
}))

vi.mock('@/lib/format', () => ({
  formatPhone: vi.fn((value: string) => value),
}))

import { POST as afterRecordPost } from './after-record/route'
import { POST as coldNoInputPost } from './cold-no-input/route'
import { POST as dialFallbackPost } from './dial-fallback/route'
import { POST as googleAdsPost } from './google-ads/route'
import { POST as handleInputPost } from './handle-input/route'
import { POST as noInputPost } from './no-input/route'
import { POST as simRingPost } from './sim-ring/route'
import { POST as voicemailPost } from './voicemail/route'
import { POST as voicemailRecordingPost } from './voicemail-recording/route'
import { POST as whisperPost } from './whisper/route'

const handlers = [
  { name: 'after-record', path: '/api/ivr/after-record', post: afterRecordPost },
  { name: 'voicemail-recording', path: '/api/ivr/voicemail-recording', post: voicemailRecordingPost },
  { name: 'google-ads', path: '/api/ivr/google-ads', post: googleAdsPost },
  { name: 'cold-no-input', path: '/api/ivr/cold-no-input', post: coldNoInputPost },
]

const newlyContainedHandlers = [
  { name: 'handle-input', path: '/api/ivr/handle-input?from=%2B19135550123', post: handleInputPost },
  { name: 'no-input', path: '/api/ivr/no-input?from=%2B19135550123', post: noInputPost },
  { name: 'sim-ring', path: '/api/ivr/sim-ring?from=%2B19135550123', post: simRingPost },
  { name: 'dial-fallback', path: '/api/ivr/dial-fallback?from=%2B19135550123', post: dialFallbackPost },
  { name: 'voicemail', path: '/api/ivr/voicemail?from=%2B19135550123', post: voicemailPost },
  { name: 'whisper', path: '/api/ivr/whisper?from=%2B19135550123', post: whisperPost },
]

function expectNoDownstreamWork() {
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
  expect(mocks.downloadRecording).not.toHaveBeenCalled()
  expect(mocks.transcribeAudio).not.toHaveBeenCalled()
  expect(mocks.analyzeCallTranscript).not.toHaveBeenCalled()
  expect(mocks.ensureManifestExists).not.toHaveBeenCalled()
  expect(mocks.updateManifestV2_1).not.toHaveBeenCalled()
  expect(mocks.resolveGoogleAdsLeadContext).not.toHaveBeenCalled()
  expect(mocks.notifyGoogleAdsTeam).not.toHaveBeenCalled()
  expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  expect(mocks.isOptedOut).not.toHaveBeenCalled()
  expect(mocks.isDuplicateSms).not.toHaveBeenCalled()
  expect(mocks.logSmsSend).not.toHaveBeenCalled()
  expect(mocks.phoneRateLimit).not.toHaveBeenCalled()
  expect(mocks.getAgentRouting).not.toHaveBeenCalled()
  expect(mocks.getLeadAlertRecipients).not.toHaveBeenCalled()
  expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
  expect(mocks.createEnrichedLeadFromProspect).not.toHaveBeenCalled()
}

function twilioRequest(path: string, fields: Record<string, string> = {}) {
  return new Request(`https://crm.savingkc.com${path}`, {
    method: 'POST',
    body: new URLSearchParams(fields),
  })
}

async function expectSafeForbidden(response: Response) {
  const twiml = await response.text()
  expect(response.status).toBe(403)
  expect(twiml).toContain('<Hangup/>')
  expect(twiml).not.toMatch(/<(?:Dial|Number|Redirect)\b/i)
}

describe('IVR Twilio signature containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(false)
  })

  it.each(handlers)('rejects unsigned $name callbacks before body or downstream work', async ({ path, post }) => {
    const request = new Request(`https://crm.savingkc.com${path}?from=%2B19135550123`, {
      method: 'POST',
    })
    const formData = vi.spyOn(request, 'formData')

    const response = await post(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid Twilio signature' })
    expect(mocks.validateTwilioWebhook).toHaveBeenCalledWith(request)
    expect(formData).not.toHaveBeenCalled()
    expectNoDownstreamWork()
  })

  it.each(newlyContainedHandlers)('contains an invalid $name signature before request or downstream work', async ({ path, post }) => {
    const request = twilioRequest(path)
    const formData = vi.spyOn(request, 'formData')

    await expectSafeForbidden(await post(request))

    expect(mocks.validateTwilioWebhook).toHaveBeenCalledWith(request)
    expect(formData).not.toHaveBeenCalled()
    expectNoDownstreamWork()
  })

  it.each(newlyContainedHandlers)('contains a $name validator failure before request or downstream work', async ({ path, post }) => {
    mocks.validateTwilioWebhook.mockRejectedValueOnce(new Error('signature validator unavailable'))
    const request = twilioRequest(path)
    const formData = vi.spyOn(request, 'formData')

    await expectSafeForbidden(await post(request))

    expect(formData).not.toHaveBeenCalled()
    expectNoDownstreamWork()
  })

  it.each([
    {
      name: 'handle-input',
      post: handleInputPost,
      request: () => twilioRequest('/api/ivr/handle-input?calledNumber=%2B18163077835', { Digits: '9' }),
      expected: '<Redirect method="POST">https://crm.savingkc.com/api/twiml-voice</Redirect>',
    },
    {
      name: 'no-input',
      post: noInputPost,
      request: () => twilioRequest('/api/ivr/no-input?calledNumber=%2B18163077835'),
      expected: '<Hangup />',
    },
    {
      name: 'sim-ring',
      post: simRingPost,
      request: () => twilioRequest('/api/ivr/sim-ring?from=%2B19135550123&calledNumber=%2B18163077835'),
      expected: '<Dial ',
    },
    {
      name: 'dial-fallback',
      post: dialFallbackPost,
      request: () => twilioRequest('/api/ivr/dial-fallback?calledNumber=%2B18163077835', { DialCallStatus: 'completed' }),
      expected: '<Response></Response>',
    },
    {
      name: 'voicemail',
      post: voicemailPost,
      request: () => twilioRequest('/api/ivr/voicemail?agent=Ernest'),
      expected: '<Record ',
    },
    {
      name: 'whisper',
      post: whisperPost,
      request: () => twilioRequest('/api/ivr/whisper'),
      expected: '<Say ',
    },
  ])('preserves valid signed $name behavior', async ({ post, request, expected }) => {
    mocks.validateTwilioWebhook.mockResolvedValueOnce(true)
    mocks.getAgentRouting.mockReturnValue({
      primary: { name: 'Ernest', phone: '+18162262552', companyNumber: '+18163077835' },
      secondary: { name: 'Casey', phone: '+18167564943', companyNumber: '+18167277667' },
    })
    mocks.getLeadAlertRecipients.mockReturnValue([
      { name: 'Ernest', phone: '+18162262552', schedule: '24_7' },
    ])

    const response = await post(request())
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain(expected)
  })
})
