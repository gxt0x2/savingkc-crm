import { describe, expect, it } from 'vitest'
import {
  centralDateString,
  centralMidnightIso,
  indexMojoRecordings,
  matchMojoRecording,
  normalizeMojoDateTime,
  parseMojoTimestamp,
} from '../../../scripts/mojo-call-evidence.mjs'

describe('Mojo script evidence helpers', () => {
  it('uses the Central calendar date and real DST offset', () => {
    expect(centralDateString(new Date('2026-09-09T02:00:00Z'))).toBe('2026-09-08')
    expect(parseMojoTimestamp('09/08/2026 02:16 PM')).toBe('2026-09-08T19:16:00.000Z')
    expect(parseMojoTimestamp('01/08/2026 02:16 PM')).toBe('2026-01-08T20:16:00.000Z')
    expect(centralMidnightIso('2026-09-08')).toBe('2026-09-08T05:00:00.000Z')
    expect(centralMidnightIso('2026-01-08')).toBe('2026-01-08T06:00:00.000Z')
    expect(normalizeMojoDateTime('09/10/2026 03:00 PM')).toBe('2026-09-10T20:00:00.000Z')
    expect(normalizeMojoDateTime('2026-01-10 15:00')).toBe('2026-01-10T21:00:00.000Z')
    expect(normalizeMojoDateTime('2026-09-10')).toBe('2026-09-10T05:00:00.000Z')
  })

  it('matches recordings to the nearest call instead of reusing the longest contact recording', () => {
    const index = indexMojoRecordings([
      { contact: { id: 7 }, audio: 'https://example.com/morning.mp3', duration: '02:00', record_id: 11, call_date: '09/08/2026 09:05 AM' },
      { contact: { id: 7 }, audio: 'https://example.com/afternoon.mp3', duration: '12:38', record_id: 12, call_date: '09/08/2026 02:16 PM' },
    ])

    expect(matchMojoRecording(index, 7, parseMojoTimestamp('09/08/2026 09:06 AM'))).toMatchObject({
      audio: 'https://example.com/morning.mp3',
      recordId: '11',
    })
    expect(matchMojoRecording(index, 7, parseMojoTimestamp('09/08/2026 02:15 PM'))).toMatchObject({
      audio: 'https://example.com/afternoon.mp3',
      recordId: '12',
    })
  })

  it('does not guess when multiple undated recordings exist for one contact', () => {
    const index = indexMojoRecordings([
      { contact: { id: 9 }, audio: 'https://example.com/a.mp3', duration: '01:00', record_id: 1 },
      { contact: { id: 9 }, audio: 'https://example.com/b.mp3', duration: '05:00', record_id: 2 },
    ])
    expect(matchMojoRecording(index, 9, parseMojoTimestamp('09/08/2026 10:00 AM'))).toBeNull()
  })

  it('accepts the provider duration_seconds field when the formatted duration is absent', () => {
    const index = indexMojoRecordings([
      { contact_id: 10, audio: 'https://example.com/c.mp3', duration_seconds: 180, record_id: 3 },
    ])
    expect(matchMojoRecording(index, 10, parseMojoTimestamp('09/08/2026 10:00 AM'))).toMatchObject({
      duration: 180,
      recordId: '3',
    })
  })
})
