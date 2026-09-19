import { describe, expect, it } from 'vitest'

import {
  MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES,
  MOBILE_MMS_MAX_BYTES,
  MOBILE_MMS_OTHER_MEDIA_MAX_BYTES,
  MobileAttachmentError,
  safeMobileAttachmentFilename,
  validateMobileMmsAttachments,
  validateMobileMessageFile,
} from './message-attachments'

describe('mobile message attachment validation', () => {
  it('accepts a bounded photo and an actual voice recording', () => {
    expect(validateMobileMessageFile(new File(['photo'], 'house.jpg', { type: 'image/jpeg' }))).toEqual({
      filename: 'house.jpg',
      mimeType: 'image/jpeg',
    })
    expect(validateMobileMessageFile(new File(['audio'], 'memo.m4a', { type: 'audio/mp4' })).mimeType).toBe('audio/mp4')
  })

  it('rejects unsupported or oversized files', () => {
    expect(() => validateMobileMessageFile(new File(['x'], 'script.html', { type: 'text/html' }))).toThrow(MobileAttachmentError)
    const oversized = new File([new Uint8Array(MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES + 1)], 'large.gif', { type: 'image/gif' })
    expect(() => validateMobileMessageFile(oversized)).toThrow('between 1 byte and 4 MB')
  })

  it('normalizes every upload to Twilio-safe filename characters and length', () => {
    expect(safeMobileAttachmentFilename('Front porch photo 2026.jpeg', 'image/jpeg')).toBe('Front-porch-phot.jpg')
    expect(safeMobileAttachmentFilename('🏠.gif', 'image/gif')).toBe('attachment.gif')
    expect(safeMobileAttachmentFilename('voice-1789787654321', 'audio/mp4')).toBe('voice-1789787654.m4a')
  })

  it('accepts supported MMS images below the combined five-megabyte boundary', () => {
    expect(() => validateMobileMmsAttachments([{
      id: 'photo-1',
      filename: 'front-yard.jpg',
      mimeType: 'image/jpeg',
      byteSize: MOBILE_MMS_MAX_BYTES - 100,
      storagePath: 'lead/photo-1',
    }], 'Hi')).not.toThrow()
  })

  it('rejects unsupported MMS media and tighter non-image payloads before provider submission', () => {
    const base = { id: 'media-1', filename: 'voice-note.m4a', storagePath: 'lead/media-1' }
    expect(() => validateMobileMmsAttachments([{
      ...base,
      mimeType: 'image/webp',
      byteSize: 100,
    }], 'Hi')).toThrow('cannot be sent by MMS')
    expect(() => validateMobileMmsAttachments([{
      ...base,
      mimeType: 'audio/mp4',
      byteSize: MOBILE_MMS_OTHER_MEDIA_MAX_BYTES + 1,
    }], 'Hi')).toThrow('500 KB MMS limit')
  })

  it('rejects a combined MMS payload at the five-megabyte boundary', () => {
    expect(() => validateMobileMmsAttachments([{
      id: 'photo-1',
      filename: 'front-yard.jpg',
      mimeType: 'image/jpeg',
      byteSize: MOBILE_MMS_MAX_BYTES - 2,
      storagePath: 'lead/photo-1',
    }], 'Hi')).toThrow('less than 5 MB')
  })
})
