// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LifecycleReconciliationPanel } from './lifecycle-reconciliation-panel'

describe('LifecycleReconciliationPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows evidence gaps as review work rather than auto-completing records', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      generatedAt: '2026-08-23T18:00:00.000Z', source: 'governed_evidence_audit', degraded: false, warning: null,
      counts: { reviewedDeals: 3, reviewedClosingFiles: 3, missingSellerHandoffs: 3, missingAssignmentHandoffs: 2, missingCloseOutcomes: 1, orphanClosingFiles: 0 },
      issues: [{ key: 'seller:1', kind: 'seller_handoff', leadId: 'lead-1', recordId: 'deal-1', title: '1 Main St', detail: 'Dispositions record predates a verified signed seller-contract handoff.', href: '/leads/lead-1' }],
    }), { status: 200 }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LifecycleReconciliationPanel /></QueryClientProvider>)
    expect(await screen.findByText('6 legacy evidence gaps need review')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is auto-completed or backfilled/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open record/ })).toHaveAttribute('href', '/leads/lead-1')
  })
})
