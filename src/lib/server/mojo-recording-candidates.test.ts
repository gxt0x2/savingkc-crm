import { describe, expect, it } from 'vitest'

import {
  buildRecordingCandidateMap,
  mojoReportDate,
  selectRecordingCandidate,
} from '../../../scripts/mojo-recording-candidates.mjs'

function recording(id: number, contactId: number, date: string) {
  return {
    record_id: id,
    contact: { id: contactId },
    date,
    duration: '01:30',
    audio: `https://app71.mojosells.com/audio/${id}`,
    agent_name: 'Casey',
    result: 'Contact',
  }
}

describe('Mojo recording candidate safety', () => {
  it('filters the over-broad provider response to the requested Central date', () => {
    const rows = [
      recording(1, 101, '08/27/2026 02:38 PM'),
      recording(2, 102, '08/26/2026 02:38 PM'),
      recording(3, 103, '06/10/2026 09:00 AM'),
    ]
    const { map, accepted } = buildRecordingCandidateMap(rows, '2026-08-27')

    expect(accepted).toBe(1)
    expect([...map.keys()]).toEqual([101])
    expect(mojoReportDate(rows[0].date)).toBe('2026-08-27')
  })

  it('selects the recording nearest the meaningful activity for repeat contacts', () => {
    const { map } = buildRecordingCandidateMap([
      recording(11, 101, '08/27/2026 09:05 AM'),
      recording(12, 101, '08/27/2026 02:35 PM'),
    ], '2026-08-27')

    expect(selectRecordingCandidate(map, 101, '08/27/2026 02:40 PM')?.recordId).toBe('12')
  })

  it('fails closed when repeat-contact recordings cannot be matched safely', () => {
    const { map } = buildRecordingCandidateMap([
      recording(11, 101, '08/27/2026 09:00 AM'),
      recording(12, 101, '08/27/2026 10:00 AM'),
    ], '2026-08-27')

    expect(selectRecordingCandidate(map, 101, '08/27/2026 08:00 PM')).toBeNull()
  })
})
