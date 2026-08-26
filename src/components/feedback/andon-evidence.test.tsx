// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AndonEvidence } from './andon-dashboard'

const attachments = [
  { id: 'image-1', feedback_id: 'andon-1', filename: 'screen.png', mime_type: 'image/png', byte_size: 1024, kind: 'image' as const, created_at: '2026-08-26T12:00:00Z' },
  { id: 'video-1', feedback_id: 'andon-1', filename: 'walkthrough.mp4', mime_type: 'video/mp4', byte_size: 2048, kind: 'video' as const, created_at: '2026-08-26T12:00:01Z' },
  { id: 'audio-1', feedback_id: 'andon-1', filename: 'voice.m4a', mime_type: 'audio/mp4', byte_size: 4096, kind: 'audio' as const, created_at: '2026-08-26T12:00:02Z' },
  { id: 'file-1', feedback_id: 'andon-1', filename: 'error.pdf', mime_type: 'application/pdf', byte_size: 8192, kind: 'file' as const, created_at: '2026-08-26T12:00:03Z' },
]

describe('AndonEvidence', () => {
  it('previews image, video, and audio evidence and offers document download', () => {
    render(<AndonEvidence attachments={attachments} loading={false} />)

    expect(screen.getByAltText('screen.png')).toHaveAttribute('src', '/api/feedback/attachments/image-1/download?preview=1')
    expect(screen.getByLabelText('Video evidence walkthrough.mp4')).toBeInTheDocument()
    expect(screen.getByLabelText('Audio evidence voice.m4a')).toBeInTheDocument()
    expect(screen.getByText('error.pdf')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute('href', '/api/feedback/attachments/file-1/download')
  })
})
