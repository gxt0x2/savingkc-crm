import { describe, expect, it } from 'vitest'

import { activityBelongsToPhoneThread, unmatchedPhoneFromThreadId } from './phone-thread'

const PERSONAL = '+18162262552'
const COMPANY = '+18166088588'
const PATH = `SM${'a'.repeat(32)}/0-mms-0.jpg`

describe('unmatched phone conversation threads', () => {
  it('treats unmatched and phone ids as the same E.164 thread', () => {
    expect(unmatchedPhoneFromThreadId(`unmatched:${PERSONAL}`)).toBe(PERSONAL)
    expect(unmatchedPhoneFromThreadId(`phone:${PERSONAL}`)).toBe(PERSONAL)
    expect(unmatchedPhoneFromThreadId(encodeURIComponent(`unmatched:${PERSONAL}`))).toBe(PERSONAL)
    expect(unmatchedPhoneFromThreadId('11111111-1111-4111-8111-111111111111')).toBeNull()
  })

  it('keeps a team photo on the phone thread and drops internal coordination', () => {
    const photo = {
      activity_type: 'sms',
      description: 'Sent a photo',
      metadata: {
        direction: 'received',
        from: PERSONAL,
        to: COMPANY,
        team_sender: true,
        num_media: 1,
        mms: [{ storage_bucket: 'inbound-mms', storage_path: PATH, content_type: 'image/jpeg' }],
      },
    }
    const coordination = {
      activity_type: 'sms',
      description: 'Internal coordination',
      metadata: { direction: 'internal', from: PERSONAL, to: COMPANY, is_team: true },
    }
    expect(activityBelongsToPhoneThread(photo, PERSONAL)).toBe(true)
    expect(activityBelongsToPhoneThread(coordination, PERSONAL)).toBe(false)
    expect(activityBelongsToPhoneThread(photo, '+19137179716')).toBe(false)
  })
})