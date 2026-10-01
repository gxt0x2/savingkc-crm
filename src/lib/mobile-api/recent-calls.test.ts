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
})
