// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppointmentModal } from './appointment-modal'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null }),
}))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(appointment: { body: unknown; status?: number }) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = String(input)
    if (url.includes('/api/settings')) return jsonResponse({ profile: null })
    return jsonResponse(appointment.body, appointment.status ?? 200)
  })
}

function appointmentRequestBody(fetchMock: ReturnType<typeof mockFetch>): string {
  const appointmentCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/leads/create-appointment'))
  return String(appointmentCall?.[1]?.body ?? '')
}

describe('AppointmentModal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the modal open and shows the server error when saving fails', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.stubGlobal('fetch', mockFetch({
      status: 403,
      body: { error: 'Appointment assignee is not authorized' },
    }))
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
    const fetchMock = mockFetch({ body: { success: true } })
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
    const request = JSON.parse(appointmentRequestBody(fetchMock)) as { scheduledAt: string }
    const centralTime = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(request.scheduledAt))
    expect(centralTime).toBe(`${tomorrow} 10:00`)
  })

  it('keeps the saved appointment visible when Google Calendar writeback fails', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    vi.stubGlobal('fetch', mockFetch({
      body: {
        success: true,
        warning: 'Appointment saved. Google Calendar was not updated. Do not create it again.',
      },
    }))
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    render(<AppointmentModal
      lead={{ id: 'lead-1', full_name: 'Seller', phone: '+18165550100', property_address: '123 Main' }}
      onClose={onClose}
      onSuccess={onSuccess}
    />)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: tomorrow } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Google Calendar was not updated')
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('defaults the agent to the signed-in user and still posts that assignee', async () => {
    const fetchMock = mockFetch({ body: { success: true } })
    vi.stubGlobal('fetch', fetchMock)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    render(<AppointmentModal
      lead={{ id: 'lead-1', full_name: 'Seller', phone: '+18165550100', property_address: '123 Main' }}
      actorName="OAuth Review (throwaway)"
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />)

    expect(screen.getByLabelText('Agent')).toHaveValue('OAuth Review (throwaway)')
    expect(screen.getByRole('option', { name: 'OAuth Review (throwaway)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ernest Dodson' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Casey Davis' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: tomorrow } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const request = JSON.parse(appointmentRequestBody(fetchMock)) as { assignedTo: string }
    expect(request.assignedTo).toBe('OAuth Review (throwaway)')
  })
})
