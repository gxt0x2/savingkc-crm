import { describe, it, expect } from 'vitest'
import { normalizeActivity, buildCommsTimeline, summarizeComms, isCommActivity, type RawActivity } from './comms-timeline'

function activity(partial: Partial<RawActivity>): RawActivity {
  return {
    id: 'a1',
    activity_type: 'call',
    description: null,
    agent: 'Casey',
    metadata: {},
    created_at: '2026-06-01T12:00:00.000Z',
    ...partial,
  }
}

describe('comms-timeline normalizer', () => {
  it('normalizes an outbound call with a reached disposition as positive', () => {
    const e = normalizeActivity(activity({
      activity_type: 'call',
      metadata: { direction: 'outbound', to: '+18165550142', disposition: 'spoke_with_owner', duration: 73, heir_name: 'Linda Powell' },
    }))!
    expect(e.channel).toBe('call')
    expect(e.direction).toBe('outbound')
    expect(e.outcome).toBe('Reached Heir')
    expect(e.outcomeTone).toBe('positive')
    expect(e.durationSec).toBe(73)
    expect(e.title).toContain('Linda Powell')
  })

  it('treats dead / dnc / wrong-number call outcomes as negative', () => {
    for (const d of ['dead', 'dnc', 'wrong_number', 'disconnected']) {
      const e = normalizeActivity(activity({ metadata: { disposition: d } }))!
      expect(e.outcomeTone, d).toBe('negative')
    }
  })

  it('maps legacy disposition tokens through the taxonomy', () => {
    const e = normalizeActivity(activity({ metadata: { disposition: 'answered' } }))!
    expect(e.outcome).toBe('Reached Heir')
    expect(e.outcomeTone).toBe('positive')
  })

  it('detects SMS direction from activity_type and from metadata', () => {
    expect(normalizeActivity(activity({ activity_type: 'sms_received' }))!.direction).toBe('inbound')
    expect(normalizeActivity(activity({ activity_type: 'sms_sent' }))!.direction).toBe('outbound')
    expect(normalizeActivity(activity({ activity_type: 'sms', metadata: { direction: 'inbound' } }))!.direction).toBe('inbound')
  })

  it('carries the SMS body and labels direction', () => {
    const e = normalizeActivity(activity({ activity_type: 'sms_received', metadata: { from: '+18165550142', body: 'call me back' } }))!
    expect(e.channel).toBe('sms')
    expect(e.title).toBe('SMS received')
    expect(e.body).toBe('call me back')
    expect(e.contact).toBe('+18165550142')
  })

  it('falls back to description for SMS/email text (where the canonical send stores it)', () => {
    const sms = normalizeActivity(activity({ activity_type: 'sms', description: 'Hi Linda, following up', metadata: { direction: 'outbound', to: '+1816' } }))!
    expect(sms.body).toBe('Hi Linda, following up')
    const email = normalizeActivity(activity({ activity_type: 'email', description: 'Offer attached', metadata: { direction: 'outbound' } }))!
    expect(email.body).toBe('Offer attached')
    // calls keep description as a summary, not a "body"
    const call = normalizeActivity(activity({ activity_type: 'call', description: 'Outbound call to Linda', metadata: {} }))!
    expect(call.body).toBeNull()
  })

  it('ignores non-communication activity rows', () => {
    expect(isCommActivity('status_change')).toBe(false)
    expect(isCommActivity('task')).toBe(false)
    expect(isCommActivity('note')).toBe(false)
    expect(normalizeActivity(activity({ activity_type: 'status_change' }))).toBeNull()
  })

  it('builds a newest-first timeline and drops non-comms', () => {
    const events = buildCommsTimeline([
      activity({ id: 'old', created_at: '2026-05-01T00:00:00Z' }),
      activity({ id: 'note', activity_type: 'note', created_at: '2026-06-10T00:00:00Z' }),
      activity({ id: 'new', created_at: '2026-06-09T00:00:00Z' }),
    ])
    expect(events.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('summarizes counts and last-reached', () => {
    const s = summarizeComms(buildCommsTimeline([
      activity({ id: 'c1', activity_type: 'call', created_at: '2026-06-01T00:00:00Z', metadata: { disposition: 'no_answer' } }),
      activity({ id: 'c2', activity_type: 'call', created_at: '2026-06-05T00:00:00Z', metadata: { disposition: 'spoke_with_owner' } }),
      activity({ id: 's1', activity_type: 'sms_sent', created_at: '2026-06-03T00:00:00Z' }),
    ]))
    expect(s.total).toBe(3)
    expect(s.calls).toBe(2)
    expect(s.sms).toBe(1)
    expect(s.lastContactAt).toBe('2026-06-05T00:00:00Z')
    expect(s.lastReachedAt).toBe('2026-06-05T00:00:00Z')
  })
})
