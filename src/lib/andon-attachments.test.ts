import { describe, expect, it } from 'vitest'

import {
  MAX_ANDON_ATTACHMENT_BYTES,
  andonAttachmentKind,
  safeAndonAttachmentName,
  validateAndonAttachment,
} from './andon-attachments'

describe('Andon attachments', () => {
  it('accepts screenshots, video, voice memos, and common documents', () => {
    expect(validateAndonAttachment({ name: 'screen.png', type: 'image/png', size: 1024 })).toBeNull()
    expect(validateAndonAttachment({ name: 'walkthrough.mov', type: 'video/quicktime', size: 2048 })).toBeNull()
    expect(validateAndonAttachment({ name: 'voice.m4a', type: '', size: 2048 })).toBeNull()
    expect(validateAndonAttachment({ name: 'error-report.pdf', type: 'application/pdf', size: 2048 })).toBeNull()
  })

  it('rejects unsupported and oversized files', () => {
    expect(validateAndonAttachment({ name: 'script.html', type: 'text/html', size: 1024 })).toContain('not a supported')
    expect(validateAndonAttachment({ name: 'fake.png', type: 'text/html', size: 1024 })).toContain('not a supported')
    expect(validateAndonAttachment({ name: 'large.mp4', type: 'video/mp4', size: MAX_ANDON_ATTACHMENT_BYTES + 1 })).toContain('50 MB')
  })

  it('classifies media and sanitizes untrusted filenames', () => {
    expect(andonAttachmentKind('audio/mp4', 'memo.m4a')).toBe('audio')
    expect(andonAttachmentKind('', 'seller-walkthrough.mov')).toBe('video')
    expect(safeAndonAttachmentName('../../ Screen shot 1.png')).toBe('Screen_shot_1.png')
  })
})
