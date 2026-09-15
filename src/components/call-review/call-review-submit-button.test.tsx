/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CallReviewSubmitButton } from './call-review-submit-button'

describe('CallReviewSubmitButton', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('lets the submitter add a quick note before sending the call to Ernest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow: { status: 'submitted', assignedReviewer: 'ernest@savingkc.com', submittedAt: '2026-09-15T13:49:22.000Z', completedAt: null, completedBy: null } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CallReviewSubmitButton activityId="call-123" />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    const note = screen.getByRole('textbox', { name: 'Quick note to reviewer' })
    expect(note).toHaveAttribute('maxlength', '500')
    fireEvent.change(note, { target: { value: '  Listen for the pricing objection.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      activityId: 'call-123',
      action: 'submit',
      framework: 'junior_acquisitions',
      assignedReviewer: 'ernest@savingkc.com',
      note: 'Listen for the pricing objection.',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Submitted to Ernest for review')
    expect(screen.queryByRole('button', { name: 'Submit for Review' })).not.toBeInTheDocument()
  })

  it('shows durable server state instead of offering a duplicate submission', () => {
    render(<CallReviewSubmitButton activityId="call-789" initialWorkflow={{ status: 'submitted', assignedReviewer: 'ernest@savingkc.com', submittedAt: '2026-09-15T13:49:22.000Z', completedAt: null, completedBy: null }} />)

    expect(screen.getByRole('status')).toHaveTextContent('Submitted to Ernest for review')
    expect(screen.queryByRole('textbox', { name: 'Quick note to reviewer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit for Review' })).not.toBeInTheDocument()
  })

  it('queues the exact call locally when a preview blocks database writes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ previewReadOnly: true, error: 'Preview is read-only.' }),
    }))

    render(<CallReviewSubmitButton activityId="call-456" recordingSid="RE123" recordingUrl="/api/recordings/RE123" durationSeconds={84} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Quick note to reviewer' }), { target: { value: 'Review rapport.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Preview submission saved. Open My Day to review it.')
    expect(JSON.parse(window.localStorage.getItem('savingkc:preview-call-review-queue:v1') || '[]')).toEqual([
      expect.objectContaining({ activityId: 'call-456', recordingSid: 'RE123', recordingUrl: '/api/recordings/RE123', durationSeconds: 84, submissionNote: 'Review rapport.' }),
    ])
  })
})
