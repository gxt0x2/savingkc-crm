/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadAiChangeReview } from './lead-ai-change-review'

const proposal = {
  id: '00000000-0000-4000-8000-000000000002',
  status: 'proposed' as const,
  summary: 'Review extracted seller details.',
  changes: [{ field: 'motivation_score' as const, label: 'Motivation score', before: 4, proposed: 8 }],
  decidedBy: null,
  decisionNote: null,
  decidedAt: null,
  appliedAt: null,
  errorCode: null,
}

describe('LeadAiChangeReview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [proposal] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: {
        ...proposal,
        status: 'applied',
        decidedBy: 'casey@savingkc.com',
      } }), { status: 200 })))
  })

  it('shows proposed values as inert and applies only after explicit approval', async () => {
    const onApplied = vi.fn()
    render(<LeadAiChangeReview leadId="00000000-0000-4000-8000-000000000001" onApplied={onApplied} />)

    expect(await screen.findByText('AI-proposed CRM changes')).toBeVisible()
    expect(screen.getByText('Nothing below changes until you approve it.')).toBeVisible()
    expect(screen.getByText('Review extracted seller details.')).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Approve & apply' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Reviewed and applied by casey@savingkc.com.')).toBeVisible()
    expect(onApplied).toHaveBeenCalledTimes(1)
  })
})
