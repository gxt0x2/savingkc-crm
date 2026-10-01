import { describe, expect, it } from 'vitest'
import { mobileRecordingUrl, mojoRecordingEventId, mojoRecordingStoragePath } from './mojo-recording'

const activityId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const storagePath = `events/${eventId}.mp3`
const noTwilio = () => null

describe('copied Mojo recording identity', () => {
  it('advertises only canonical copied evidence through the CRM bearer route', () => {
    const metadata = { provider: 'mojo', event_id: eventId, recording_storage_path: storagePath, recordingUrl: `/api/recordings/mojo/${eventId}` }
    expect(mojoRecordingEventId(metadata)).toBe(eventId)
    expect(mobileRecordingUrl(activityId, metadata, undefined, noTwilio)).toBe(`/api/mobile/v1/calls/${activityId}/recording`)
    expect(mojoRecordingStoragePath(eventId, storagePath)).toBe(storagePath)
  })

  it('rejects an uncopied URL, mismatched event, and arbitrary storage paths', () => {
    expect(mojoRecordingEventId({ event_id: eventId, recordingUrl: 'https://app71.mojosells.com/recording.mp3' })).toBeNull()
    expect(mojoRecordingEventId({ event_id: eventId, recording_storage_path: storagePath, recordingUrl: `/api/recordings/mojo/${activityId}` })).toBeNull()
    expect(mojoRecordingStoragePath(eventId, '../other.mp3')).toBeNull()
    expect(mobileRecordingUrl(activityId, { event_id: eventId, recording_storage_path: `events/${activityId}.mp3` }, undefined, noTwilio)).toBeNull()
  })
})
