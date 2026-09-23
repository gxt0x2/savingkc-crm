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
  it('rejects a sole months-old recording and a sole undated recording', () => {
    for (const call_date of ['06/18/2026 11:54 AM', undefined]) {
      const index = indexMojoRecordings([{ contact_id: 7, audio: 'https://example.com/old.mp3', duration: '05:00', record_id: 1, call_date }])
      expect(matchMojoRecording(index, 7, parseMojoTimestamp('09/10/2026 10:00 AM'))).toBeNull()
    }
  })
  it('picks the nearest in-window recording and keeps the other id for review', () => {
    const index = indexMojoRecordings([
      { contact_id: 7, audio: 'https://example.com/a.mp3', duration: '01:00', record_id: 1, call_date: '09/10/2026 10:00 AM' },
      { contact_id: 7, audio: 'https://example.com/b.mp3', duration: '05:00', record_id: 2, call_date: '09/10/2026 10:10 AM' },
    ])
    expect(matchMojoRecording(index, 7, parseMojoTimestamp('09/10/2026 10:01 AM'))).toMatchObject({
      audio: 'https://example.com/a.mp3',
      duration: 60,
      recordId: '1',
      secondaryRecordIds: ['2'],
    })
    expect(matchMojoRecording(index, 7, parseMojoTimestamp('09/10/2026 10:09 AM'))).toMatchObject({
      audio: 'https://example.com/b.mp3',
      recordId: '2',
    })
  })
  it('breaks an equal-distance tie by longest duration', () => {
    const index = indexMojoRecordings([
      { contact_id: 6815, audio: 'https://example.com/drop.mp3', duration_seconds: 74, record_id: 87428384, call_date: '09/10/2026 10:00 AM' },
      { contact_id: 6815, audio: 'https://example.com/reconnect.mp3', duration_seconds: 2273, record_id: 87429607, call_date: '09/10/2026 10:10 AM' },
    ])
    expect(matchMojoRecording(index, 6815, parseMojoTimestamp('09/10/2026 10:05 AM'))).toMatchObject({
      audio: 'https://example.com/reconnect.mp3',
      duration: 2273,
      recordId: '87429607',
      secondaryRecordIds: ['87428384'],
    })
  })
  it('picks the longer reconnect recording when it is the nearest timed candidate', () => {
    const index = indexMojoRecordings([
      { contact_id: 6815, audio: 'https://example.com/drop.mp3', duration_seconds: 74, record_id: 87428384, call_date: '09/10/2026 10:00 AM' },
      { contact_id: 6815, audio: 'https://example.com/reconnect.mp3', duration_seconds: 2273, record_id: 87429607, call_date: '09/10/2026 10:02 AM' },
    ])
    expect(matchMojoRecording(index, 6815, parseMojoTimestamp('09/10/2026 10:40 AM'))).toMatchObject({
      recordId: '87429607',
      duration: 2273,
      secondaryRecordIds: ['87428384'],
    })
  })
  it('stays unmatched when every dated recording is outside the window', () => {
    const index = indexMojoRecordings([
      { contact_id: 7, audio: 'https://example.com/a.mp3', duration: '01:00', record_id: 1, call_date: '09/10/2026 08:00 AM' },
      { contact_id: 7, audio: 'https://example.com/b.mp3', duration: '05:00', record_id: 2, call_date: '09/10/2026 12:00 PM' },
    ])
    expect(matchMojoRecording(index, 7, parseMojoTimestamp('09/10/2026 10:00 AM'))).toBeNull()
  })
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
      { contact_id: 10, audio: 'https://example.com/c.mp3', duration_seconds: 180, record_id: 3, call_date: '09/08/2026 10:00 AM' },
    ])
    expect(matchMojoRecording(index, 10, parseMojoTimestamp('09/08/2026 10:00 AM'))).toMatchObject({
      duration: 180,
      recordId: '3',
    })
  })
})
