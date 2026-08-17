import { describe, expect, it } from 'vitest'
import {
  buildRecordingSummary,
  isGoogleAdsCall,
  mergeRecordingReviewMetadata,
  mergeCallReviewWorkflow,
  playableRecordingUrl,
  readRecordingDuration,
  readRecordingReview,
  readCallReviewWorkflow,
} from './call-recordings'

describe('marketing call recordings helpers', () => {
  it('reads Twilio recording duration from the supported metadata shapes', () => {
    expect(readRecordingDuration({ duration: 122.4 })).toBe(122)
    expect(readRecordingDuration({ recordingDuration: '305' })).toBe(305)
    expect(readRecordingDuration({ RecordingDuration: '61' })).toBe(61)
    expect(readRecordingDuration({ duration: 'not-a-number' })).toBe(0)
  })

  it('builds protected playback URLs from recording SIDs', () => {
    expect(playableRecordingUrl({ recordingSid: 'RE123' })).toBe('/api/recordings/RE123')
    expect(playableRecordingUrl({ RecordingSid: 'RE 456' })).toBe('/api/recordings/RE%20456')
    expect(playableRecordingUrl({ recordingUrl: '/api/recordings/RE789' })).toBe('/api/recordings/RE789')
    expect(playableRecordingUrl({ RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE789.mp3' })).toBe('/api/recordings/RE789')
    expect(playableRecordingUrl({ recordingUrl: 'https://example.com/recordings/RE789' })).toBeNull()
  })

  it('reads and merges recording review metadata without mutating existing fields', () => {
    const base = {
      recordingSid: 'RE123',
      campaign: 'Search 2026',
      recording_review: { reviewed_by: 'old@example.com' },
    }
    const merged = mergeRecordingReviewMetadata(base, {
      outcome: 'spam',
      note: 'Vendor call',
      reviewedAt: '2026-06-04T12:00:00.000Z',
      reviewedBy: 'ernest@example.com',
    })

    expect(base).toMatchObject({ recording_review: { reviewed_by: 'old@example.com' } })
    expect(readRecordingReview(merged)).toEqual({
      outcome: 'spam',
      note: 'Vendor call',
      reviewedAt: '2026-06-04T12:00:00.000Z',
      reviewedBy: 'ernest@example.com',
    })
    expect(merged.campaign).toBe('Search 2026')
  })

  it('detects Google Ads call context from source or tracking number metadata', () => {
    expect(isGoogleAdsCall({ traffic_source: 'google_ads' })).toBe(true)
    expect(isGoogleAdsCall({ tracking_number: '(816) 608-8808' })).toBe(true)
    expect(isGoogleAdsCall({ tracking_number: '8166086648' })).toBe(true)
    expect(isGoogleAdsCall({ campaign: 'Direct mail' })).toBe(false)
  })

  it('stores the submit and completed review workflow without losing recording metadata', () => {
    const submitted = mergeCallReviewWorkflow({ recordingSid: 'RE123' }, {
      status: 'submitted', framework: 'junior_acquisitions', submittedAt: '2026-08-15T12:00:00Z', submittedBy: 'casey@savingkc.com', assignedReviewer: 'ernest@savingkc.com', tags: ['Needs Coaching', 'Motivation'], submissionNote: 'Please review discovery',
    })
    const completed = mergeCallReviewWorkflow(submitted, {
      status: 'completed', completedAt: '2026-08-15T13:00:00Z', completedBy: 'ernest@savingkc.com', score: 2.5, answers: { permission: 3 }, reviewNote: 'Slow down', voiceoverPath: 'call-review-voiceovers/call-1/review.webm', voiceoverMimeType: 'audio/webm',
    })
    expect(completed.recordingSid).toBe('RE123')
    expect(readCallReviewWorkflow(completed)).toMatchObject({ status: 'completed', framework: 'junior_acquisitions', assignedReviewer: 'ernest@savingkc.com', tags: ['Needs Coaching', 'Motivation'], score: 2.5, answers: { permission: 3 }, reviewNote: 'Slow down', voiceoverPath: 'call-review-voiceovers/call-1/review.webm', voiceoverMimeType: 'audio/webm' })
  })

  it('summarizes review workload and call quality bands', () => {
    expect(buildRecordingSummary([
      { durationSeconds: 140, outcome: 'unreviewed', isGoogleAds: true },
      { durationSeconds: 301, outcome: 'seller', isGoogleAds: true },
      { durationSeconds: 220, outcome: 'spam', isGoogleAds: false },
      { durationSeconds: 180, outcome: 'review_later', isGoogleAds: false },
    ])).toEqual({
      total: 4,
      needsReview: 2,
      seller: 1,
      spam: 1,
      followUp: 0,
      googleAds: 2,
      overFiveMinutes: 1,
      averageDurationSeconds: 210,
    })
  })
})
