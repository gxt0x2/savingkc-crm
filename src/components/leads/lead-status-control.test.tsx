// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadStatusControl } from './lead-status-control'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LeadStatusControl', () => {
  it('marks a record not a lead with one of the approved structured reasons', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          classification: 'dead',
          stage: 'dead',
          priority: 'cold',
          deadReason: 'wrong_or_disconnected',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="lead" station="contacted" agent="Ernest" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Lead' }))
    fireEvent.click(screen.getByRole('button', { name: /Not a lead/ }))
    fireEvent.click(screen.getByLabelText('Wrong or disconnected number'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark not a lead' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/lifecycle', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"deadReason":"wrong_or_disconnected"'),
    })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      classification: 'dead',
      dead_reason: 'wrong_or_disconnected',
    })))
  })

  it('requires useful notes for Other', () => {
    render(<LeadStatusControl leadId="lead-1" classification="lead" station="new" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Lead' }))
    fireEvent.click(screen.getByRole('button', { name: /Not a lead/ }))
    fireEvent.click(screen.getByLabelText('Other — see notes'))

    expect(screen.getByRole('button', { name: 'Mark not a lead' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Add context an agent or AI will need later…'), {
      target: { value: 'Vendor soliciting roofing work.' },
    })
    expect(screen.getByRole('button', { name: 'Mark not a lead' })).toBeEnabled()
  })

  it('shows the dead reason at a glance and restores the record as a lead', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          classification: 'lead',
          stage: 'contacted',
          priority: 'warm',
          deadReason: null,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="dead" station="dead" deadReason="listed" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Not a lead — Listed with an agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore as lead' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/lifecycle', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"stage":"contacted"'),
    })))
  })

  it('adds unclassified New intake to Leads and advances it to the contacted stage', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          classification: 'lead',
          stage: 'contacted',
          priority: 'warm',
          deadReason: null,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="intake-1" classification={null} station="new" agent="Ernest" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: New intake' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Leads' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/intake-1/lifecycle', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"stage":"contacted"'),
    })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      classification: 'lead',
      station: 'contacted',
    })))
  })

  it('returns an incorrectly classified lead to unclassified New intake', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { classification: null, stage: 'new', priority: 'warm', deadReason: null } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="lead" station="contacted" agent="Ernest" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'New intake' }))
    fireEvent.click(screen.getByRole('button', { name: 'Return to New' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/lifecycle', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"stage":"new"'),
    })))
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ classification: null, station: 'new' }))
  })

  it('promotes one verified lead to Opportunity through the governed qualified transition', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { classification: 'opportunity', stage: 'qualified', priority: 'hot', deadReason: null },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="lead" station="contacted" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Opportunity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Opportunity' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/lifecycle', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"stage":"qualified"'),
    })))
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      classification: 'opportunity',
      station: 'qualified',
      priority: 'hot',
    }))
  })

  it('keeps the dialog open and explains which qualification pillars are missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error: 'Qualification incomplete. Verify PRICE before moving this record to Opportunities.',
        code: 'qualification_incomplete',
        missingPillars: ['PRICE'],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="lead" station="contacted" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Opportunity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to Opportunity' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Opportunity requires verified qualification')
    expect(screen.getByRole('alert')).toHaveTextContent('Verify price first. Nothing changed on this record.')
    expect(screen.getByRole('link', { name: 'Review qualification' })).toHaveAttribute('href', '/leads/lead-1#lead-qualification')
    expect(screen.getByRole('dialog', { name: 'Pipeline status' })).toBeVisible()
  })
})
