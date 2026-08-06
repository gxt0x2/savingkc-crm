import { describe, expect, it } from 'vitest'

import { normalizeLeadRecordingActivities } from './lead-recording-activities'

const createdAt = '2026-08-06T15:00:00.000Z'

function activity(metadata: Record<string, unknown> | null, activityType = 'call') {
  return {
    id: 'activity-1',
    activity_type: activityType,
    created_at: createdAt,
    metadata,
  }
}

describe('lead recording activity normalization', () => {
  it('normalizes legacy Twilio metadata to the protected playback route', () => {
    const [normalized] = normalizeLeadRecordingActivities([
      activity({
        RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RElegacy.mp3',
        RecordingDuration: '125',
      }),
    ], [])

    expect(normalized.metadata).toMatchObject({
      recordingUrl: '/api/recordings/RElegacy',
      recordingDuration: 125,
    })
  })

  it('backfills a missing activity URL from the matching manifest recording SID', () => {
    const [normalized] = normalizeLeadRecordingActivities([
      activity({ RecordingSid: 'REmanifest' }),
    ], [{
      date: '2026-08-06T15:20:00.000Z',
      recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/REmanifest',
    }])

    expect(normalized.metadata?.recordingUrl).toBe('/api/recordings/REmanifest')
  })

  it('uses the nearest manifest recording within the callback completion window', () => {
    const [normalized] = normalizeLeadRecordingActivities([
      activity({ callSid: 'CA123' }),
    ], [
      { date: '2026-08-06T15:12:00.000Z', recordingUrl: '/api/recordings/REnearest' },
      { date: '2026-08-06T18:00:00.000Z', recordingUrl: '/api/recordings/RElate' },
    ])

    expect(normalized.metadata?.recordingUrl).toBe('/api/recordings/REnearest')
  })

  it('does not add recording metadata to non-call activities', () => {
    const original = activity({ RecordingSid: 'REnote' }, 'note')
    expect(normalizeLeadRecordingActivities([original], [])).toEqual([original])
  })

  it('never exposes an unproxyable Twilio URL to the browser', () => {
    const original = activity({
      RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/not-a-recording-sid',
    })
    expect(normalizeLeadRecordingActivities([original], [])[0].metadata).toEqual(original.metadata)
  })
})
