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
    expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeDisabled()
  })

  it('fills editable fields from a cited AI proposal and carries only its generation id into approval', async () => {
    const onSubmitted = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: '10000000-0000-4000-8000-000000000001', full_name: 'Seller Example', property_address: '123 Main St' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          proposal: {
            kind: 'callback',
            title: 'Call seller after family review',
            notes: 'Ask whether the family review changed the seller timeline and record the decision.',
            dueAt: '2026-08-24T18:00:00.000Z',
            rationale: 'The seller requested a callback after speaking with family.',
            confidence: 'high',
          },
          generationId: '30000000-0000-4000-8000-000000000001',
          citations: [{ name: 'call activity', url: 'https://crm.savingkc.com/leads/10000000-0000-4000-8000-000000000001?section=activity' }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { id: 'run-1', status: 'awaiting_approval' } }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' })

    render(<ApprovedFollowUpRunForm onSubmitted={onSubmitted} />)
    fireEvent.change(screen.getByLabelText('Contact'), { target: { value: 'Seller' } })
    fireEvent.click(await screen.findByRole('button', { name: /Seller Example/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))

    await screen.findByText('AI draft · high confidence')
    expect(screen.getByLabelText('Task title')).toHaveValue('Call seller after family review')
    expect(screen.getByLabelText('Type')).toHaveValue('callback')
    expect(screen.getByRole('link', { name: 'call activity' })).toHaveAttribute('href', expect.stringContaining('/leads/'))
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/ai/next-action-proposal', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'next-action-proposal:request-1' }),
    }))
    const workflowRequest = fetchMock.mock.calls[2][1]
    expect(JSON.parse(workflowRequest.body)).toMatchObject({
      workflowId: 'approved-follow-up-task',
      input: {
        leadId: '10000000-0000-4000-8000-000000000001',
        title: 'Call seller after family review',
        kind: 'callback',
        aiGenerationId: '30000000-0000-4000-8000-000000000001',
      },
    })
  })
})
