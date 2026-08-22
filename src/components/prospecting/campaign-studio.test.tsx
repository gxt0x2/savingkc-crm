/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CampaignStudio, EMPTY_CAMPAIGN_FORM, type CampaignForm } from './campaign-studio'

function StudioHarness({ onCreate = vi.fn(), sourceCampaignName }: { onCreate?: (event: React.FormEvent) => void; sourceCampaignName?: string }) {
  const [form, setForm] = useState<CampaignForm>({
    ...EMPTY_CAMPAIGN_FORM,
    steps: EMPTY_CAMPAIGN_FORM.steps.map((step) => ({ ...step })),
  })
  return <CampaignStudio
    form={form}
    pendingLeadIds={['lead-1', 'lead-2']}
    saving={false}
    sourceCampaignName={sourceCampaignName}
    onChange={setForm}
    onCancel={vi.fn()}
    onCreate={onCreate}
    onAddToExisting={vi.fn()}
  />
}

describe('CampaignStudio', () => {
  it('explains that a copied setup starts without the prior audience or activity', () => {
    render(<StudioHarness sourceCampaignName="August Absentee" />)
    expect(screen.getByText('Setup copied from August Absentee.')).toBeVisible()
    expect(screen.getByText(/Audience and activity were intentionally left behind/)).toBeVisible()
  })

  it('builds an SMS cadence with a live seller preview and a safe draft review', () => {
    render(<StudioHarness />)

    fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: 'September absentee owners' } })
    fireEvent.click(screen.getByRole('button', { name: /SMS cadence/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))

    expect(screen.getByRole('heading', { name: 'Build the conversation.' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Warm follow-up/ }))
    expect(screen.getByText(/Helen, Your name here with SavingKC/)).toBeVisible()
    expect(screen.getByText('2 messages')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Review before you activate.' })).toBeVisible()
    expect(screen.getByText('2 selected contacts')).toBeVisible()
    expect(screen.getByText('Creation does not start sending or calling')).toBeVisible()
    expect(screen.getByRole('button', { name: /Create safe draft/ })).toBeEnabled()
  })

  it('describes a truthful single-line calling workflow', () => {
    render(<StudioHarness />)

    fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: 'Cold call block' } })
    fireEvent.click(screen.getByRole('button', { name: /Power dialer/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))

    expect(screen.getByText('One live call')).toBeVisible()
    expect(screen.getByText('One seller, one line, no fake predictive claims')).toBeVisible()
    expect(screen.getByText('Required outcome')).toBeVisible()
  })
})
