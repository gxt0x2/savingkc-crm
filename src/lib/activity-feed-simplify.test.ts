import { describe, expect, it } from 'vitest'

import {
  formatCallDuration,
  simplifyActivityFeedItems,
  type ActivityFeedItem,
} from './activity-feed-simplify'

function item(overrides: Partial<ActivityFeedItem> & Pick<ActivityFeedItem, 'id' | 'timestamp'>): ActivityFeedItem {
  return {
    type: 'status_change',
    title: 'Status update',
    ...overrides,
  }
}

describe('formatCallDuration', () => {
  it('uses the same minutes-and-seconds format as the recording player', () => {
    expect(formatCallDuration(24)).toBe('0:24')
    expect(formatCallDuration(60)).toBe('1:00')
    expect(formatCallDuration(146)).toBe('2:26')
    expect(formatCallDuration(678)).toBe('11:18')
    expect(formatCallDuration(758)).toBe('12:38')
    expect(formatCallDuration(758.9)).toBe('12:38')
  })
})

describe('simplifyActivityFeedItems', () => {
  it('turns Howard-like provider events into one row per real call', () => {
    const activities: ActivityFeedItem[] = [
      item({
        id: 'summary',
        timestamp: '2026-09-15T17:39:10.000Z',
        rawType: 'note',
        title: 'Agent Note',
        content: 'AI Call Analysis: The call was brief and confused.',
        agentName: 'AI',
      }),
      item({
        id: 'transcript',
        timestamp: '2026-09-15T17:39:08.000Z',
        rawType: 'note',
        title: 'Agent Note',
        content: 'Call transcript: Hey Howard, what\'s going on?',
        agentName: 'AI',
      }),
      item({
        id: 'recording',
        timestamp: '2026-09-15T17:39:04.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Call recording',
        direction: 'inbound',
        recordingUrl: '/api/recordings/RE123',
        recordingDuration: 758,
        metadata: { source: 'twilio_recording_callback', recordingSid: 'RE123', from: '+19134884960' },
      }),
      item({
        id: 'inbound',
        timestamp: '2026-09-15T17:39:00.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Inbound call from Howard Snitkoff connected live with Casey',
        direction: 'inbound',
        statusBadge: '2:26',
        agentName: 'Casey',
        metadata: { status: 'completed', duration: 146, from: '+19134884960' },
      }),
      item({
        id: 'outbound-final',
        timestamp: '2026-09-15T17:38:21.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        statusBadge: '0:21',
        dispositionLabel: 'No Answer',
        dispositionTone: 'neutral',
        agentName: 'Ernest',
        metadata: { status: 'no-answer', duration: 21, to: '+19134884960' },
      }),
      item({
        id: 'outbound-duplicate',
        timestamp: '2026-09-15T17:38:20.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        statusBadge: 'No answer',
        metadata: { status: 'no-answer', to: '+19134884960' },
      }),
      item({
        id: 'outbound-started',
        timestamp: '2026-09-15T17:38:00.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        metadata: { status: 'initiated', to: '+19134884960' },
      }),
      item({
        id: 'milestone',
        timestamp: '2026-09-15T16:01:00.000Z',
        rawType: 'status_change',
        content: 'Call quality milestone: Connected call 5+ minutes',
      }),
      item({
        id: 'human-note',
        timestamp: '2026-09-15T15:00:00.000Z',
        rawType: 'note',
        title: 'Agent Note',
        content: 'Seller prefers an in-person walkthrough.',
      }),
    ]

    const result = simplifyActivityFeedItems(activities)
    const calls = result.filter((activity) => activity.rawType === 'call')

    expect(result).toHaveLength(3)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      title: 'Inbound call',
      statusBadge: '12:38',
      recordingUrl: '/api/recordings/RE123',
      recordingDuration: 758,
      callSummary: 'The call was brief and confused.',
      callTranscript: 'Hey Howard, what\'s going on?',
    })
    expect(calls[1]).toMatchObject({
      title: 'Outbound call',
      statusBadge: '0:21',
      dispositionLabel: 'No Answer',
    })
    expect(result.some((activity) => activity.id === 'milestone')).toBe(false)
    expect(result.some((activity) => activity.id === 'human-note')).toBe(true)
  })

  it('does not merge calls to different phones', () => {
    const result = simplifyActivityFeedItems([
      item({
        id: 'one',
        timestamp: '2026-09-15T17:00:00.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        metadata: { status: 'completed', to: '+19135550101' },
      }),
      item({
        id: 'two',
        timestamp: '2026-09-15T17:00:10.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        metadata: { status: 'completed', to: '+19135550102' },
      }),
    ])

    expect(result).toHaveLength(2)
  })

  it('does not merge nearby calls with different provider call IDs', () => {
    const result = simplifyActivityFeedItems([
      item({
        id: 'first-call',
        timestamp: '2026-09-15T17:00:00.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        metadata: { status: 'completed', to: '+19135550101', callSid: 'CA111' },
      }),
      item({
        id: 'second-call',
        timestamp: '2026-09-15T17:00:10.000Z',
        rawType: 'call',
        type: 'call',
        title: 'Outbound call',
        direction: 'outbound',
        metadata: { status: 'completed', to: '+19135550101', callSid: 'CA222' },
      }),
    ])

    expect(result).toHaveLength(2)
  })
})
