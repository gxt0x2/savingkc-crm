/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CallReviewSubmitButton } from './call-review-submit-button'

describe('CallReviewSubmitButton', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('submits directly to Ernest using the Jr. Acquisitions scorecard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(<CallReviewSubmitButton activityId="call-123" />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      activityId: 'call-123',
      action: 'submit',
      framework: 'junior_acquisitions',
      assignedReviewer: 'ernest@savingkc.com',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to Ernest for review.')
  })

  it('queues the exact call locally when a preview blocks database writes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ previewReadOnly: true, error: 'Preview is read-only.' }),
    }))

    render(<CallReviewSubmitButton activityId="call-456" recordingSid="RE123" recordingUrl="/api/recordings/RE123" durationSeconds={84} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Preview submission saved. Open My Day to review it.')
    expect(JSON.parse(window.localStorage.getItem('savingkc:preview-call-review-queue:v1') || '[]')).toEqual([
      expect.objectContaining({ activityId: 'call-456', recordingSid: 'RE123', recordingUrl: '/api/recordings/RE123', durationSeconds: 84 }),
    ])
  })
})
