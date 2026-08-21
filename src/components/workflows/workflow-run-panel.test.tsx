// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunPanel } from './workflow-run-panel'

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
})
