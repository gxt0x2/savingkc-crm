/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScorecardResultsPage } from './scorecard-results-page'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

const completedCall = {
  id: 'call-94a4',
  leadId: 'lead-gunner',
  leadName: 'Gunner Byrd',
  leadUrl: '/leads/lead-gunner',
  leadSource: 'mojo_call',
  propertyAddress: '1010 S MAIN Rd Independence, MO 64056',
  city: 'Independence',
  state: 'MO',
  recordingUrl: '/api/recordings/RE123',
  direction: 'inbound',
  durationSeconds: 1329,
  createdAt: '2026-08-25T17:49:13.257Z',
  analysisSummary: 'Seller call summary.',
  reviewWorkflow: {
    status: 'completed' as const,
    framework: 'junior_acquisitions' as const,
    submittedAt: '2026-08-25T18:11:11.124Z',
    submittedBy: 'casey@savingkc.com',
    assignedReviewer: 'ernest@savingkc.com',
    completedAt: '2026-08-26T14:30:53.816Z',
    completedBy: 'ernest@savingkc.com',
    score: 1.5,
    criticalScore: 2.02,
    needsCoaching: true,
    coachingReasons: ['Price discovery'],
    scoringVersion: 'weighted-v1',
    answers: { permission: 3 },
    tags: ['Needs Coaching'],
    reviewNote: 'Ask for price directly.',
    voiceoverPath: null,
    voiceoverMimeType: null,
  },
}

describe('ScorecardResultsPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reopens a reviewed call and moves the operator to the grading queue', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ ok: true, workflow: { ...completedCall.reviewWorkflow, status: 'submitted' } }) }
      }
      return { ok: true, json: async () => ({ recordings: [completedCall], viewerEmail: 'casey@savingkc.com' }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ScorecardResultsPage />)

    const owner = await screen.findByText('Gunner Byrd')
    const row = owner.closest('tr')
    expect(row).not.toBeNull()
    fireEvent.click(within(row!).getByRole('button', { name: /View/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen review' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/marketing/call-recordings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ activityId: 'call-94a4', action: 'reopen' }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Gunner Byrd is back in Needs Review')
    expect(screen.getByRole('tab', { name: 'Needs Review' })).toHaveAttribute('aria-selected', 'true')
  })
})
