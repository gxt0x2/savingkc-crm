// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowDraftValidation } from './workflow-draft-validation'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('workflow draft validation', () => {
  it('shows an honest non-executing validation report', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        report: {
          workflowId: 'draft-1',
          workflowVersion: 1,
          generatedAt: '2026-08-24T12:00:00.000Z',
          mode: 'validation_only',
          readyForReview: true,
          readyForPublish: false,
          checks: [
            { id: 'definition_contract', label: 'Definition contract', status: 'pass', detail: 'Required fields are present.' },
            { id: 'executor_mapping', label: 'Executable action mapping', status: 'blocked', detail: 'Actions are descriptive only.' },
          ],
          plannedEffects: [{ order: 1, label: 'Create a task', executor: 'not_wired', effect: 'potential_crm_write' }],
          boundary: { mutatesData: true, approvalPolicy: 'user_confirmation', protectedResources: [], execution: 'configuration' },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkflowDraftValidation workflowId="draft-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Validate draft' }))

    expect(await screen.findByText('Ready for executor design—not ready to publish.')).toBeInTheDocument()
    expect(screen.getByText('Actions are descriptive only.')).toBeInTheDocument()
    expect(screen.getByText(/No workflow run, call, message/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/definitions/draft-1/validation', { cache: 'no-store' })
  })

  it('shows validation unavailability instead of a false pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Workflow validation is unavailable.' }),
    }))

    render(<WorkflowDraftValidation workflowId="draft-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Validate draft' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Workflow validation is unavailable.'))
    expect(screen.queryByText(/Ready for executor design/)).not.toBeInTheDocument()
  })
})
