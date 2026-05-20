import { describe, expect, it } from 'vitest'
import {
  getCallQualityMilestones,
  getHighestCallQualityMilestone,
  isPpcTrackingNumber,
  parseCallDurationSeconds,
} from './call-quality-events'

describe('call-quality-events', () => {
  it('parses Twilio duration values defensively', () => {
    expect(parseCallDurationSeconds('61')).toBe(61)
    expect(parseCallDurationSeconds(61.4)).toBe(61)
    expect(parseCallDurationSeconds('-5')).toBe(0)
    expect(parseCallDurationSeconds('')).toBeNull()
    expect(parseCallDurationSeconds('not-a-number')).toBeNull()
  })

  it('returns no milestones before 60 seconds', () => {
    expect(getCallQualityMilestones(59).map((m) => m.event)).toEqual([])
  })

  it('returns cumulative milestones as the call gets longer', () => {
    expect(getCallQualityMilestones(60).map((m) => m.event)).toEqual(['call_connected_60s'])
    expect(getCallQualityMilestones(120).map((m) => m.event)).toEqual([
      'call_connected_60s',
      'call_connected_2m',
    ])
    expect(getCallQualityMilestones(300).map((m) => m.event)).toEqual([
      'call_connected_60s',
      'call_connected_2m',
      'call_connected_5m',
    ])
  })

  it('identifies the highest reached milestone for primary conversion selection', () => {
    expect(getHighestCallQualityMilestone(119)?.event).toBe('call_connected_60s')
    expect(getHighestCallQualityMilestone(299)?.event).toBe('call_connected_2m')
    expect(getHighestCallQualityMilestone(300)?.event).toBe('call_connected_5m')
  })

  it('identifies the Search 2026 PPC tracking number', () => {
    expect(isPpcTrackingNumber('816-608-8808')).toBe(true)
    expect(isPpcTrackingNumber('+18166088808')).toBe(true)
    expect(isPpcTrackingNumber('+18164292900')).toBe(false)
  })
})
