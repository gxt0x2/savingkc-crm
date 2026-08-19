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
import { POST as googleAdsPost } from './google-ads/route'
import { POST as voicemailRecordingPost } from './voicemail-recording/route'

const handlers = [
  { name: 'after-record', path: '/api/ivr/after-record', post: afterRecordPost },
  { name: 'voicemail-recording', path: '/api/ivr/voicemail-recording', post: voicemailRecordingPost },
  { name: 'google-ads', path: '/api/ivr/google-ads', post: googleAdsPost },
  { name: 'cold-no-input', path: '/api/ivr/cold-no-input', post: coldNoInputPost },
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
})
