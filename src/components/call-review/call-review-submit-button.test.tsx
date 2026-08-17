/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CallReviewSubmitButton } from './call-review-submit-button'

describe('CallReviewSubmitButton', () => {
  afterEach(() => vi.unstubAllGlobals())

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
})
