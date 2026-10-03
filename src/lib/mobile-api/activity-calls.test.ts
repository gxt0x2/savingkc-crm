import { describe, expect, it } from 'vitest'
import { normalizeMobileCallActivities } from './activity-calls'

const callbackId = 'e09b21e0-6b04-58f1-a6a3-86869d22ca12'
const callId = '6c5e17a2-127a-5c5f-8ef2-8240ec3afe01'
const recordingSid = `RE${'a'.repeat(32)}`
const callSid = `CA${'b'.repeat(32)}`
const call = { id: callId, activity_type: 'call', description: 'Outbound call completed', agent: 'Ernest', created_at: '2026-10-02T16:25:43Z', metadata: { source: 'twilio_status_callback', direction: 'outbound', status: 'completed', callSid, to: '+19135550123' } }
const callback = { id: callbackId, activity_type: 'call', description: 'Call recording available', agent: 'System', created_at: '2026-10-02T16:25:46Z', metadata: { source: 'twilio_recording_callback', direction: 'inbound', parentCallSid: callSid, recordingSid, recordingUrl: `/api/recordings/${recordingSid}`, recordingSourceUrl: 'https://provider.invalid/private.mp3', duration: 70 } }

describe('shared mobile call activity projection', () => {
  it('replays the observed Eric shape as one answered outbound call with secure playback', () => {
    const result = normalizeMobileCallActivities([callback, call])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: callId, agent: 'Ernest', metadata: { direction: 'outbound', outcome: 'answered', duration: 70, phone: '+19135550123', recordingUrl: `/api/mobile/v1/calls/${callbackId}/recording` } })
    expect(result[0].metadata).not.toHaveProperty('voicemailReceived')
    expect(JSON.stringify(result)).not.toContain('/api/recordings/')
    expect(JSON.stringify(result)).not.toContain('provider.invalid')
  })

  it('produces the same result regardless of response hydration order', () => {
    expect(normalizeMobileCallActivities([callback, call])).toEqual(normalizeMobileCallActivities([call, callback]))
  })

  it('keeps no-recording missed calls honest and preserves actual voicemail provenance', () => {
    const result = normalizeMobileCallActivities([
      { id: 'missed', activity_type: 'missed_call', created_at: '2026-10-02T17:00:00Z', metadata: { from: '+19135550123' } },
      { id: 'voicemail', activity_type: 'voicemail', created_at: '2026-10-02T18:00:00Z', metadata: { from: '+19135550123' } },
    ])
    expect(result[0]).toMatchObject({ id: 'voicemail', metadata: { direction: 'inbound', outcome: 'voicemail', voicemailReceived: true } })
    expect(result[1]).toMatchObject({ id: 'missed', metadata: { direction: 'inbound', outcome: 'no_answer' } })
    expect(result.every((row) => !row.metadata?.recordingUrl)).toBe(true)
  })

  it('does not turn an unanchored callback into a guessed missed call or merge separate attempts by phone', () => {
    expect(normalizeMobileCallActivities([callback])).toEqual([])
    expect(normalizeMobileCallActivities([call, { ...call, id: 'other-attempt', metadata: { ...call.metadata, callSid: 'CA-other' } }])).toHaveLength(2)
  })

  it('strips malformed legacy URLs and handles nonobject metadata safely', () => {
    const result = normalizeMobileCallActivities([{ ...call, metadata: { direction: 'inbound', recordingUrl: 'https://evil.invalid/file.mp3' } }, { id: 'null', activity_type: 'call', metadata: null, created_at: '2026-10-02T12:00:00Z' }])
    expect(JSON.stringify(result)).not.toContain('evil.invalid')
    expect(result).toHaveLength(2)
  })
})
