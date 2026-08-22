/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CampaignStudio, EMPTY_CAMPAIGN_FORM, type CampaignForm } from './campaign-studio'

function StudioHarness({ onCreate = vi.fn(), sourceCampaignName, editingCampaignName }: { onCreate?: (event: React.FormEvent) => void; sourceCampaignName?: string; editingCampaignName?: string }) {
  const [form, setForm] = useState<CampaignForm>({
    ...EMPTY_CAMPAIGN_FORM,
    steps: EMPTY_CAMPAIGN_FORM.steps.map((step) => ({ ...step })),
  })
  return <CampaignStudio
    form={form}
    pendingAudienceCount={2}
    saving={false}
    sourceCampaignName={sourceCampaignName}
    editingCampaignName={editingCampaignName}
    editingAudienceCount={editingCampaignName ? 2 : 0}
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

  it('explains that editing preserves the existing audience and does not activate', () => {
    render(<StudioHarness editingCampaignName="August Absentee" />)
    expect(screen.getByText('Editing August Absentee.')).toBeVisible()
    expect(screen.getByText(/current audience and activity will stay attached/)).toBeVisible()
    expect(screen.getByText(/Saving does not activate it/)).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: 'August Absentee corrected' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByText('2 contacts stay attached')).toBeVisible()
    expect(screen.getByText(/does not add, remove, or restart contacts/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save draft setup' })).toBeEnabled()
  })

  it('builds an SMS cadence with a live seller preview and a safe draft review', () => {
    render(<StudioHarness />)

    fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: 'September absentee owners' } })
    fireEvent.click(screen.getByRole('button', { name: /SMS cadence/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))

    expect(screen.getByRole('heading', { name: 'Build the conversation.' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.change(screen.getByLabelText('Send window start'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('Send window end'), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: /Warm follow-up/ }))
    expect(screen.getByText(/Helen, Your name here with SavingKC/)).toBeVisible()
    expect(screen.getByText('2 messages')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Review before you activate.' })).toBeVisible()
    expect(screen.getByText('2 selected contacts')).toBeVisible()
    expect(screen.getByText('Creation does not start sending or calling')).toBeVisible()
    expect(screen.getByText(/Monday–Saturday · 10:00–18:00/)).toBeVisible()
    expect(screen.getByRole('button', { name: /Create safe draft/ })).toBeEnabled()
  })

  it('requires at least one SMS send day before review', () => {
    render(<StudioHarness />)
    fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: 'No schedule' } })
    fireEvent.click(screen.getByRole('button', { name: /SMS cadence/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) fireEvent.click(screen.getByRole('button', { name: day }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one send day.')
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('explains an invalid SMS send window before review', () => {
    render(<StudioHarness />)
    fireEvent.change(screen.getByRole('textbox', { name: /Campaign name/ }), { target: { value: 'Bad schedule' } })
    fireEvent.click(screen.getByRole('button', { name: /SMS cadence/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.change(screen.getByLabelText('Send window start'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('Send window end'), { target: { value: '10:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('End time must be later than start time.')
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
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
