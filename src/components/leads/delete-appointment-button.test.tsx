// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DeleteAppointmentButton } from './delete-appointment-button'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'
const APPOINTMENT_ID = '20000000-0000-4000-8000-000000000002'

describe('Delete appointment control', () => {
  it('confirms before deleting and keeps Cancel as a separate close action', async () => {
    const onDeleted = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<DeleteAppointmentButton leadId={LEAD_ID} appointmentId={APPOINTMENT_ID} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete appointment' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete this appointment? This cannot be undone.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete appointment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/delete-appointment', expect.objectContaining({
      method: 'POST',
    }))
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({ leadId: LEAD_ID, appointmentId: APPOINTMENT_ID })
  })
})
