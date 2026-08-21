// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GovernedNextAction, openLeadNextAction } from './governed-next-action'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('governed lead next action', () => {
  it('selects the primary open task and ignores completed work', () => {
    expect(openLeadNextAction([
      { id: 'done', activity_type: 'task', description: 'Old task', metadata: { status: 'completed' }, created_at: '2026-08-20T12:00:00Z' },
      { id: 'later', activity_type: 'task', description: 'Later task', metadata: { due_date: '2026-08-24T18:00:00Z' }, created_at: '2026-08-21T12:00:00Z' },
      { id: 'primary', activity_type: 'callback', description: 'Call seller', metadata: { primary_next_action: true, due_date: '2026-08-25T18:00:00Z', assigned_to: 'Casey' }, created_at: '2026-08-21T13:00:00Z' },
    ])).toMatchObject({ id: 'primary', title: 'Call seller', assignedTo: 'Casey' })
  })

  it('shows an existing committed task without offering to spend on AI', () => {
    render(<GovernedNextAction leadId={LEAD_ID} task={{ id: 'task-1', title: 'Call seller', dueAt: null, assignedTo: 'Casey' }} appointment={null} appointmentIsPast={false} onAppointment={vi.fn()} onAppointmentOutcome={vi.fn()} />)
    expect(screen.getByText('Call seller')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open in Tasks' })).toHaveAttribute('href', '/tasks?q=Call%20seller')
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument()
  })

  it('drafts from cited evidence and requests approval without creating a task directly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          proposal: {
            kind: 'callback', title: 'Call seller after family review',
            notes: 'Ask whether the family review changed the seller timeline and record the decision.',
            dueAt: '2026-08-24T18:00:00.000Z', rationale: 'The seller requested a callback after speaking with family.', confidence: 'high',
          },
          generationId: '30000000-0000-4000-8000-000000000001',
          citations: [{ name: 'Call activity', url: `https://crm.savingkc.com/leads/${LEAD_ID}?section=activity` }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: { id: 'run-1', status: 'awaiting_approval' } }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' })

    render(<GovernedNextAction leadId={LEAD_ID} task={null} appointment={null} appointmentIsPast={false} onAppointment={vi.fn()} onAppointmentOutcome={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    await screen.findByText('Cited AI draft · high confidence')
    fireEvent.change(screen.getByLabelText('Next action title'), { target: { value: 'Call seller after the family decision' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request admin approval' }))

    await screen.findByText('Approval requested')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/ai/next-action-proposal', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/workflows/runs', expect.objectContaining({ method: 'POST' }))
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(payload).toMatchObject({
      workflowId: 'approved-follow-up-task',
      input: {
        leadId: LEAD_ID,
        title: 'Call seller after the family decision',
        kind: 'callback',
        aiGenerationId: '30000000-0000-4000-8000-000000000001',
      },
    })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/calendar/tasks')).toBe(false)
    expect(screen.getByText(/No task exists yet/)).toBeVisible()
  })
})
