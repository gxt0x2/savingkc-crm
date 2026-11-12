import { describe, expect, it } from 'vitest'

import { conversationMmsViews, isSafeInboundMmsPath, presentConversationMmsActivity } from './inbound-mms-view'

const SID = `SM${'a'.repeat(32)}`
const MMS_SID = `MM${'b'.repeat(32)}`

describe('conversation MMS views', () => {
  it('points the timeline at the private media route and drops unsafe paths', () => {
    const path = `${SID}/0-mms-0.jpg`
    expect(isSafeInboundMmsPath(path)).toBe(true)
    expect(isSafeInboundMmsPath(`${MMS_SID}/0-mms-0.jpg`)).toBe(true)
    expect(isSafeInboundMmsPath('../secrets.jpg')).toBe(false)
    expect(isSafeInboundMmsPath(`${MMS_SID}/../0-mms-0.jpg`)).toBe(false)
    const [photo] = conversationMmsViews({
      mms: [
        { storage_bucket: 'inbound-mms', storage_path: path, content_type: 'image/jpeg' },
        { storage_bucket: 'inbound-mms', storage_path: 'https://api.twilio.com/media', content_type: 'image/jpeg' },
      ],
    })
    expect(photo).toEqual({
      src: `/api/conversations/mms?path=${encodeURIComponent(path)}`,
      contentType: 'image/jpeg',
      label: 'Photo 1',
    })
    expect(conversationMmsViews({ mms: [{ storage_bucket: 'other', storage_path: path }] })).toEqual([])
  })

  it('captions an empty inbound MM bubble and keeps a recovered photo on the activity', () => {
    const path = `${MMS_SID}/0-mms-0.jpg`
    const metadata = {
      direction: 'received',
      message_sid: MMS_SID,
      from: '+19137179716',
      num_media: 1,
      mms: [{ storage_bucket: 'inbound-mms', storage_path: path, content_type: 'image/jpeg' }],
    }
    expect(presentConversationMmsActivity({
      activity_type: 'sms',
      description: '',
      metadata: { direction: 'received', message_sid: MMS_SID, from: '+19137179716' },
    }).description).toBe('Photo unavailable')
    expect(presentConversationMmsActivity({
      activity_type: 'sms',
      description: '   ',
      metadata,
    })).toMatchObject({ description: 'Sent a photo', metadata })
    expect(presentConversationMmsActivity({
      activity_type: 'sms',
      description: 'See the kitchen',
      metadata: { direction: 'received', message_sid: MMS_SID },
    }).description).toBe('See the kitchen')
    expect(presentConversationMmsActivity({
      activity_type: 'note',
      description: '',
      metadata: { direction: 'received', message_sid: MMS_SID },
    }).description).toBe('')
  })
})
