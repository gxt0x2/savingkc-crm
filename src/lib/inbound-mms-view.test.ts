import { describe, expect, it } from 'vitest'

import { conversationMmsViews, isSafeInboundMmsPath } from './inbound-mms-view'

const SID = `SM${'a'.repeat(32)}`

describe('conversation MMS views', () => {
  it('points the timeline at the private media route and drops unsafe paths', () => {
    const path = `${SID}/0-mms-0.jpg`
    expect(isSafeInboundMmsPath(path)).toBe(true)
    expect(isSafeInboundMmsPath('../secrets.jpg')).toBe(false)
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
})
