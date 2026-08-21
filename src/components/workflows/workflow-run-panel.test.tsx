// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunPanel } from './workflow-run-panel'

vi.mock('@/hooks/use-is-admin', () => ({ useIsAdmin: () => ({ isAdmin: true, loading: false }) }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('workflow run panel', () => {
  it('runs the approved read-only health executor with an idempotency key', async () => {
    const completed = {
      id: 'run-1',
      workflow_id: 'workflow-registry-health',
      workflow_version: 1,
      status: 'succeeded',
      requested_by: 'Ernest',
      attempt_count: 1,
      max_attempts: 3,
      output: { healthy: true, definitions: 29, warnings: 0 },
      error_message: null,
      created_at: '2026-08-20T12:00:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: completed }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [completed] }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkflowRunPanel />)
    await waitFor(() => expect(screen.getByText(/No governed runs yet/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Run registry health' }))

    await waitFor(() => expect(screen.getByText('29 definitions checked · 0 warnings')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/workflows/runs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^workflow-registry-health:/) }),
    }))
  })

  it('shows migration-first unavailability instead of a false empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Workflow run history is unavailable.' }),
    }))
    render(<WorkflowRunPanel />)
    expect(await screen.findByText('Execution ledger unavailable.')).toBeInTheDocument()
    expect(screen.queryByText(/No governed runs yet/)).not.toBeInTheDocument()
  })

  it('lets an administrator approve the exact pending task and refreshes its result', async () => {
    const awaiting = {
      id: 'run-task-1',
      workflow_id: 'approved-follow-up-task',
      workflow_version: 1,
      status: 'awaiting_approval',
      requested_by: 'Casey',
      attempt_count: 0,
      max_attempts: 3,
      input: {
        title: 'Call seller after title review',
        assignedTo: 'Casey',
        dueAt: '2026-08-22T15:00:00.000Z',
        aiGenerationId: '30000000-0000-4000-8000-000000000001',
        aiConfidence: 'high',
        aiRationale: 'The seller requested a callback after the family title review.',
        aiSources: [{
          name: 'Call activity',
          url: 'https://crm.savingkc.com/leads/10000000-0000-4000-8000-000000000001?section=activity',
        }],
      },
      output: null,
      error_message: null,
      created_at: '2026-08-21T12:00:00.000Z',
    }
    const succeeded = { ...awaiting, status: 'succeeded', output: awaiting.input }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [awaiting] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ run: succeeded }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [succeeded] }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkflowRunPanel />)
    expect(await screen.findByText('AI-assisted proposal · high confidence')).toBeInTheDocument()
    expect(screen.getByText('The seller requested a callback after the family title review.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call activity' })).toHaveAttribute('href', expect.stringContaining('/leads/'))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve & run' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve & run' })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/workflows/runs/run-task-1/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'approved' }),
    }))
  })
})
