// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }) },
  }),
}))

import { FeedbackForm } from './feedback-form'

describe('FeedbackForm attachments', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    mocks.uploadToSignedUrl.mockResolvedValue({ data: { path: 'feedback/andon-1/screen.png' }, error: null })
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/feedback/submit') return { ok: true, json: async () => ({ feedback_id: 'andon-1' }) }
      if (url.endsWith('/attachments/prepare')) return { ok: true, json: async () => ({ bucket: 'andon-attachments', path: 'feedback/andon-1/upload-screen.png', token: 'signed-token' }) }
      if (url.endsWith('/attachments/complete')) return { ok: true, json: async () => ({ attachment: { id: 'attachment-1' } }) }
      throw new Error(`Unexpected request: ${url}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uploads selected evidence after raising the Andon and closes after completion', async () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(<FeedbackForm defaultSection="Lead details" onClose={onClose} onSubmit={onSubmit} />)

    const screenshot = new File(['image'], 'screen.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(screen.getByLabelText('Attach evidence'), { target: { files: [screenshot] } })
    expect(screen.getByText('screen.png')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'The promotion button returned an error.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Raise Andon' }))

    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      'feedback/andon-1/upload-screen.png',
      'signed-token',
      screenshot,
      expect.objectContaining({ contentType: 'image/png', upsert: false }),
    ))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/feedback/submit',
      '/api/feedback/andon-1/attachments/prepare',
      '/api/feedback/andon-1/attachments/complete',
    ])
  })

  it('rejects an unsupported attachment before submission', () => {
    render(<FeedbackForm onClose={vi.fn()} onSubmit={vi.fn()} />)
    const html = new File(['<script>'], 'unsafe.html', { type: 'text/html' })

    fireEvent.change(screen.getByLabelText('Attach evidence'), { target: { files: [html] } })

    expect(screen.getByRole('alert')).toHaveTextContent('not a supported image, video, audio, or document file')
    expect(screen.queryByText('unsafe.html', { selector: 'strong' })).not.toBeInTheDocument()
  })

  it('retries a failed attachment without raising a duplicate Andon', async () => {
    let completeAttempts = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/feedback/submit') return { ok: true, json: async () => ({ feedback_id: 'andon-1' }) }
      if (url.endsWith('/attachments/prepare')) return { ok: true, json: async () => ({ bucket: 'andon-attachments', path: 'feedback/andon-1/upload-screen.png', token: 'signed-token' }) }
      if (url.endsWith('/attachments/complete')) {
        completeAttempts += 1
        return completeAttempts === 1
          ? { ok: false, json: async () => ({ error: 'Storage verification failed.' }) }
          : { ok: true, json: async () => ({ attachment: { id: 'attachment-1' } }) }
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const onSubmit = vi.fn()
    render(<FeedbackForm onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Attach evidence'), { target: { files: [new File(['image'], 'screen.png', { type: 'image/png', lastModified: 1 })] } })
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'The save button returned an error.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Raise Andon' }))

    await screen.findByText(/The Andon was raised, but an attachment failed/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry attachments' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/feedback/submit')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/attachments/complete'))).toHaveLength(2)
  })
})
