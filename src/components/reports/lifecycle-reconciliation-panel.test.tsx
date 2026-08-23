// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LifecycleReconciliationPanel } from './lifecycle-reconciliation-panel'

describe('LifecycleReconciliationPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows evidence gaps as review work rather than auto-completing records', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      generatedAt: '2026-08-23T18:00:00.000Z', source: 'governed_evidence_audit', degraded: false, warning: null,
      counts: { reviewedDeals: 3, reviewedClosingFiles: 3, missingSellerHandoffs: 3, missingAssignmentHandoffs: 2, missingCloseOutcomes: 1, orphanClosingFiles: 0 },
      issues: [{ key: 'seller:1', kind: 'seller_handoff', leadId: '11111111-1111-4111-8111-111111111111', recordId: '22222222-2222-4222-8222-222222222222', title: '1 Main St', detail: 'Dispositions record predates a verified signed seller-contract handoff.', href: '/leads/lead-1', canAttest: true, candidateId: null }],
    }), { status: 200 }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LifecycleReconciliationPanel /></QueryClientProvider>)
    expect(await screen.findByText('6 legacy evidence gaps need review')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is auto-completed or backfilled/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open record/ })).toHaveAttribute('href', '/leads/lead-1')
    fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    expect(screen.getByRole('dialog', { name: 'Verify a signed seller contract' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record verified evidence' })).toBeDisabled()
  })

  it('submits evidence and confirmation without a client actor field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        generatedAt: '2026-08-23T18:00:00.000Z', source: 'governed_evidence_audit', degraded: false, warning: null,
        counts: { reviewedDeals: 1, reviewedClosingFiles: 0, missingSellerHandoffs: 1, missingAssignmentHandoffs: 0, missingCloseOutcomes: 0, orphanClosingFiles: 0 },
        issues: [{ key: 'seller:1', kind: 'seller_handoff', leadId: '11111111-1111-4111-8111-111111111111', recordId: '22222222-2222-4222-8222-222222222222', title: '1 Main St', detail: 'Missing evidence', href: '/leads/lead-1', canAttest: true, candidateId: null }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ handoff: { status: 'accepted' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ generatedAt: '2026-08-23T18:01:00.000Z', source: 'governed_evidence_audit', degraded: false, warning: null, counts: { reviewedDeals: 1, reviewedClosingFiles: 0, missingSellerHandoffs: 0, missingAssignmentHandoffs: 0, missingCloseOutcomes: 0, orphanClosingFiles: 0 }, issues: [] }), { status: 200 }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LifecycleReconciliationPanel /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Review evidence' }))
    fireEvent.change(screen.getByLabelText('Evidence reference'), { target: { value: 'Signed contract in title file 88' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Record verified evidence' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const submitted = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(submitted).toMatchObject({ kind: 'seller_handoff', evidenceReference: 'Signed contract in title file 88', confirmed: true })
    expect(submitted).not.toHaveProperty('actor')
    expect(submitted).not.toHaveProperty('actorName')
  })
})
