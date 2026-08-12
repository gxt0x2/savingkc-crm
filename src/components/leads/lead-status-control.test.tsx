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
        lead: {
          classification: 'dead',
          station: 'dead',
          priority: 'cold',
          dead_reason: 'wrong_or_disconnected',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="lead" station="contacted" agent="Ernest" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Lead' }))
    fireEvent.click(screen.getByRole('button', { name: /Not a lead/ }))
    fireEvent.click(screen.getByLabelText('Wrong or disconnected number'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark not a lead' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads', expect.objectContaining({
      method: 'PATCH',
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
        lead: {
          classification: 'lead',
          station: 'contacted',
          priority: 'warm',
          dead_reason: null,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="lead-1" classification="dead" station="dead" deadReason="listed" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: Not a lead — Listed with an agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore as lead' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"dead_reason":null'),
    })))
  })

  it('adds unclassified New intake to Leads and advances it to the contacted stage', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        lead: {
          classification: 'lead',
          station: 'contacted',
          priority: 'warm',
          dead_reason: null,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadStatusControl leadId="intake-1" classification={null} station="new" agent="Ernest" onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change pipeline status. Current: New intake' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Leads' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"classification":"lead","station":"contacted"'),
    })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      classification: 'lead',
      station: 'contacted',
    })))
  })
})
