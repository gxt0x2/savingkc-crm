import { describe, expect, it } from 'vitest'
import { buildMobileRecentCalls, type RecentCallActivityRow } from './recent-calls'

function row(id: string, metadata: Record<string, unknown>, createdAt = '2026-10-01T12:00:00Z'): RecentCallActivityRow {
  return { id, lead_id: 'lead-1', activity_type: 'call', metadata, created_at: createdAt }
}

describe('mobile recent call projection', () => {
  it('collapses provider and operator rows while keeping the operator outcome', () => {
    const items = buildMobileRecentCalls([
      row('provider', { source: 'twilio_status_callback', callSid: 'call-1', direction: 'outbound', status: 'completed', to: '+18165550123' }),
      row('operator', { source: 'savingkc_mobile', callSid: 'call-1', direction: 'outbound', outcome: 'voicemail', phone: '+18165550123' }, '2026-10-01T12:01:00Z'),
    ])
    expect(items).toMatchObject([{ id: 'operator', outcome: 'voicemail', phone: '+18165550123' }])
  })

  it('keeps failed attempts and missed inbound calls truthful', () => {
    const items = buildMobileRecentCalls([
      row('blocked', { source: 'outbound_call_policy', status: 'blocked', phone: '+18165550124' }),
      { ...row('missed', { direction: 'inbound', from: '+18165550125' }), activity_type: 'missed_call' },
    ])
    expect(items.find((item) => item.id === 'blocked')?.outcome).toBe('failed')
    expect(items.find((item) => item.id === 'missed')).toMatchObject({ direction: 'inbound', phone: '+18165550125', outcome: 'no_answer' })
  })

  it('retains cold-callback classification when a higher-ranked disposition wins the grouped call', () => {
    const items = buildMobileRecentCalls([
      row('callback', { callSid: 'callback-1', direction: 'inbound', calledNumber: '+18166404701', from: '+18165550125' }),
      row('disposition', { source: 'savingkc_mobile', callSid: 'callback-1', direction: 'inbound', outcome: 'no_answer', from: '+18165550125' }, '2026-10-01T12:01:00Z'),
      row('company', { direction: 'inbound', calledNumber: '+18166088588', from: '+18165550126', outcome: 'no_answer' }),
    ])
    expect(items.find((item) => item.id === 'disposition')).toMatchObject({ inboundRoute: 'cold_callback', direction: 'inbound' })
    expect(items.find((item) => item.id === 'company')).toMatchObject({ inboundRoute: null, direction: 'inbound' })
  })

  it('classifies only explicit legacy cold-callback markers when the called DID is unavailable', () => {
    const items = buildMobileRecentCalls([
      row('press-one', { direction: 'inbound', source: 'cold_callback_press_1', from: '+18165550125' }),
      row('no-input', { direction: 'inbound', tag: 'cold_callback_no_input', from: '+18165550126' }),
      row('ordinary', { direction: 'inbound', source: 'inbound_ivr', from: '+18165550127' }),
    ])
    expect(items.find((item) => item.id === 'press-one')?.inboundRoute).toBe('cold_callback')
    expect(items.find((item) => item.id === 'no-input')?.inboundRoute).toBe('cold_callback')
    expect(items.find((item) => item.id === 'ordinary')?.inboundRoute).toBeNull()
  })

  it('keeps a provider recording and real agent on a higher-ranked operator disposition', () => {
    const recordingActivityId = '11111111-1111-4111-8111-111111111111'
    const recordingSid = `RE${'a'.repeat(32)}`
    const items = buildMobileRecentCalls([
      { ...row(recordingActivityId, { source: 'twilio_status_callback', callSid: 'call-3', recordingUrl: `/api/recordings/${recordingSid}`, direction: 'incoming', from: '+18165550125', to: '+18165550126' }), agent: 'Casey' },
      row('operator', { source: 'savingkc_mobile', callSid: 'call-3', outcome: 'voicemail', phone: '+18165550125' }, '2026-10-01T12:01:00Z'),
    ])
    expect(items).toMatchObject([{
      id: 'operator', outcome: 'voicemail', recordingUrl: `/api/mobile/v1/calls/${recordingActivityId}/recording`, agent: 'Casey',
    }])
  })

  it('keeps a copied Mojo recording on its source call while rejecting uncopied provider URLs', () => {
    const activityId = '11111111-1111-4111-8111-111111111111'
    const eventId = '22222222-2222-4222-8222-222222222222'
    const items = buildMobileRecentCalls([
      row(activityId, { source: 'mojo_call_event', provider: 'mojo', event_id: eventId,
        recording_storage_path: `events/${eventId}.mp3`, recordingUrl: `/api/recordings/mojo/${eventId}` }),
      row('uncopied', { source: 'mojo_call_event', provider: 'mojo', event_id: eventId,
        recording_url: 'https://app71.mojosells.com/audio.mp3' }, '2026-10-01T11:00:00Z'),
    ])
    expect(items.find((item) => item.id === activityId)?.recordingUrl).toBe(`/api/mobile/v1/calls/${activityId}/recording`)
    expect(items.find((item) => item.id === 'uncopied')?.recordingUrl).toBeNull()
  })
})
