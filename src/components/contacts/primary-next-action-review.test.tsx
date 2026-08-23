/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }))

import { PrimaryNextActionReviewDialog } from './primary-next-action-review'

const LEAD_ID = '11111111-1111-4111-8111-111111111111'

describe('PrimaryNextActionReviewDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('crypto', { randomUUID: () => 'review-id' })
  })

  it('offers only server-approved operator tasks and selects the locked version', async () => {
    const onResolved = vi.fn()
    const onClose = vi.fn()
    mocks.useQuery.mockReturnValue({
      data: {
        schemaVersion: 1,
        leadId: LEAD_ID,
        activeOpportunity: true,
        resolutionKind: 'select',
        primaryNextAction: null,
        excludedAdvisoryCount: 2,
        candidates: [{
          key: 'activity:task-1',
          kind: 'follow_up',
          title: 'Call seller about price',
          description: 'Operator note',
          status: 'pending',
          dueAt: '2026-08-24T15:00:00.000Z',
          assignedTo: 'Casey',
          version: 4,
          provenanceClass: 'legacy_operator',
        }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<PrimaryNextActionReviewDialog leadId={LEAD_ID} contactName="Jordan Seller" onClose={onClose} onResolved={onResolved} />)

    expect(screen.getByText(/AI, manifest, event, and unreviewed automation suggestions cannot be selected/)).toBeVisible()
    expect(screen.getByText('2 advisory or untrusted rows were excluded from this decision.')).toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: /Call seller about price/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use selected task' }))

    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    const request = fetchMock.mock.calls[0]
    expect(request[0]).toBe(`/api/contacts/${LEAD_ID}/primary-next-action`)
    expect(JSON.parse(request[1].body)).toEqual({
      action: 'select_existing',
      workItemKey: 'activity:task-1',
      expectedVersion: 4,
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('requires a clear task, owner policy, and due date on the create path', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        schemaVersion: 1,
        leadId: LEAD_ID,
        activeOpportunity: true,
        resolutionKind: 'create',
        primaryNextAction: null,
        excludedAdvisoryCount: 1,
        candidates: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<PrimaryNextActionReviewDialog leadId={LEAD_ID} contactName="Jordan Seller" onClose={vi.fn()} onResolved={vi.fn()} />)

    const submit = screen.getByRole('button', { name: 'Create primary action' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Action' }), { target: { value: 'Call seller with revised offer' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'Gertha' } })
    fireEvent.click(submit)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      action: 'create',
      title: 'Call seller with revised offer',
      kind: 'follow_up',
      assignedTo: 'Gertha',
    })
  })
})
