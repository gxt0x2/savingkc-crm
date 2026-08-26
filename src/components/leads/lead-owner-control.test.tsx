// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadOwnerControl } from './lead-owner-control'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LeadOwnerControl', () => {
  it('assigns a seller through the governed lifecycle command', async () => {
    const onChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { owner: 'Casey' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadOwnerControl leadId="lead-1" owner={null} onChanged={onChanged} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Assigned person' }), { target: { value: 'Casey' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/lifecycle', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'assign', owner: 'Casey' }),
    })))
    expect(onChanged).toHaveBeenCalledWith('Casey')
  })

  it('keeps the current owner and shows the server error when assignment fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'Owner is not authorized' }),
    }))

    render(<LeadOwnerControl leadId="lead-1" owner="Ernest" onChanged={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Assigned person' }), { target: { value: 'Gertha' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Owner is not authorized')
    expect(screen.getByRole('combobox', { name: 'Assigned person' })).toHaveValue('Ernest')
  })
})
