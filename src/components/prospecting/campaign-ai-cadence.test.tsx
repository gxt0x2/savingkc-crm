/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignAiCadence } from './campaign-ai-cadence'

const proposal = {
  draft: {
    rationale: 'A short sequence gives the seller room to respond.',
    steps: [
      { delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} with SavingKC. Would you consider selling {{property_address}}?' },
      { delayMinutes: 1440, bodyTemplate: 'Just following up, {{first_name}}. Is selling something you would consider this year?' },
    ],
  },
  generationId: '30000000-0000-4000-8000-000000000001',
  model: 'openai/gpt-5.6-luna',
  approvalRequired: true as const,
}

describe('CampaignAiCadence', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'cadence-test-request' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a generated draft separate until the operator applies it', async () => {
    const onApply = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(proposal), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const existing = [{ delayMinutes: 0, bodyTemplate: 'Existing operator-authored message stays active.' }]
    render(<CampaignAiCadence campaignName="September absentee" currentSteps={existing} onApply={onApply} />)

    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(await screen.findByText('Saved AI draft')).toBeVisible()
    expect(screen.getByText('Not applied')).toBeVisible()
    expect(onApply).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/prospecting-cadence', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'cadence-test-request' }),
      body: JSON.stringify({ campaignName: 'September absentee', currentSteps: existing }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Apply draft' }))
    expect(onApply).toHaveBeenCalledWith(proposal.draft.steps)
    await waitFor(() => expect(screen.queryByText('Saved AI draft')).not.toBeInTheDocument())
  })

  it('surfaces a server denial without changing the cadence', async () => {
    const onApply = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'AI access is unavailable.' }), { status: 503 })))
    render(<CampaignAiCadence campaignName="September absentee" currentSteps={[]} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI access is unavailable.')
    expect(onApply).not.toHaveBeenCalled()
  })
})
