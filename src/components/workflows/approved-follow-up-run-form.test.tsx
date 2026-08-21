// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovedFollowUpRunForm } from './approved-follow-up-run-form'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('approved follow-up run form', () => {
  it('searches a bounded contact list and requests approval without creating a task directly', async () => {
    const onSubmitted = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: '10000000-0000-4000-8000-000000000001',
            full_name: 'Seller Example',
            property_address: '123 Main St',
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { id: 'run-1', status: 'awaiting_approval' } }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' })

    render(<ApprovedFollowUpRunForm onSubmitted={onSubmitted} />)
    fireEvent.change(screen.getByLabelText('Contact'), { target: { value: 'Seller' } })
    fireEvent.click(await screen.findByRole('button', { name: /Seller Example/ }))
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Call after title review' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-22T10:00' } })
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Casey' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/leads/search?q=Seller&limit=8', expect.objectContaining({ cache: 'no-store' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/workflows/runs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'approved-follow-up-task:request-1' }),
    }))
    const request = fetchMock.mock.calls[1][1]
    expect(JSON.parse(request.body)).toMatchObject({
      workflowId: 'approved-follow-up-task',
      input: {
        leadId: '10000000-0000-4000-8000-000000000001',
        title: 'Call after title review',
        assignedTo: 'Casey',
        kind: 'follow_up',
      },
    })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/calendar/tasks')).toBe(false)
  })

  it('keeps approval disabled until an explicit CRM contact is selected', () => {
    render(<ApprovedFollowUpRunForm onSubmitted={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Call seller' } })
    expect(screen.getByRole('button', { name: 'Request approval' })).toBeDisabled()
  })
})
