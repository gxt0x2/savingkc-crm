// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppointmentModal } from './appointment-modal'

describe('AppointmentModal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the modal open and shows the server error when saving fails', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Appointment assignee is not authorized' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })))
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    render(<AppointmentModal
      lead={{ id: 'lead-1', full_name: 'Seller', phone: '+18165550100', property_address: '123 Main' }}
      onClose={onClose}
      onSuccess={onSuccess}
    />)

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: tomorrow } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Appointment assignee is not authorized')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes only after the appointment is confirmed by the server', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    render(<AppointmentModal
      lead={{ id: 'lead-1', full_name: 'Seller', phone: '+18165550100', property_address: '123 Main' }}
      onClose={onClose}
      onSuccess={onSuccess}
    />)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: tomorrow } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { scheduledAt: string }
    expect(request.scheduledAt).toBe(new Date(`${tomorrow}T10:00:00`).toISOString())
  })
})
