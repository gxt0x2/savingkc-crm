/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MyDayCallReview } from './my-day-call-review'

describe('MyDayCallReview submitter notes', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows the submitter note in the queue and inside the grader', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        viewerEmail: 'ernest@savingkc.com',
        recordings: [{
          id: 'call-42',
          leadName: 'Gunner Byrd',
          recordingUrl: '/api/recordings/RE42',
          durationSeconds: 184,
          analysisSummary: null,
          reviewWorkflow: {
            status: 'submitted',
            framework: 'junior_acquisitions',
            score: null,
            submittedBy: 'casey@savingkc.com',
            assignedReviewer: 'ernest@savingkc.com',
            submissionNote: 'Listen for the pricing objection near the end.',
            tags: [],
            aiStatus: 'idle',
          },
        }],
      }),
    }))

    render(<MyDayCallReview surface="scorecard" />)

    expect(await screen.findByText('Listen for the pricing objection near the end.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Score Call' }))

    const dialog = await screen.findByRole('dialog', { name: 'Gunner Byrd' })
    expect(within(dialog).getByText('Note to reviewer')).toBeInTheDocument()
    expect(within(dialog).getByText('Listen for the pricing objection near the end.')).toBeInTheDocument()
    expect(within(dialog).getByText('Submitted by casey@savingkc.com')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  })
})
