'use client'

import { useEffect, useState } from 'react'
import { AiChangeProposalCard } from '@/components/ai/ai-change-proposal-card'
import { Icon } from '@/components/ui/icon'
import type { AiChangeProposal } from '@/lib/ai-change-proposal'

async function responsePayload(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(body?.error || 'AI change review is unavailable.')
  return body
}

export function LeadAiChangeReview({ leadId, onApplied }: { leadId: string; onApplied?: () => void }) {
  const [proposals, setProposals] = useState<AiChangeProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setProposals([])
      try {
        const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/ai-change-proposals`, { cache: 'no-store' })
        const body = await responsePayload(response)
        if (!cancelled) setProposals(Array.isArray(body.proposals) ? body.proposals : [])
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'AI change review is unavailable.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [leadId])

  async function decide(proposal: AiChangeProposal, decision: 'approved' | 'rejected') {
    const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/ai-change-proposals`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposalId: proposal.id,
        decision,
        decisionKey: `lead-ai:${proposal.id}:${decision}`,
      }),
    })
    const body = await responsePayload(response)
    const next = body.proposal as AiChangeProposal
    setProposals((current) => current.map((item) => item.id === next.id ? next : item))
    if (next.status === 'applied') onApplied?.()
    return next
  }

  return (
    <section className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4 lg:col-span-2" aria-labelledby="ai-change-review-title">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]"><Icon name="fact_check" className="text-lg" /></span>
        <div>
          <h3 id="ai-change-review-title" className="text-sm font-black text-[var(--crm-ink)]">AI change review</h3>
          <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Model suggestions stay separate from the contact record until a team member reviews them.</p>
        </div>
      </div>
      {loading ? <p role="status" className="mt-4 text-xs text-[var(--crm-text-muted)]">Loading proposed changes…</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-300">{error}</p> : null}
      {!loading && !error && proposals.length === 0 ? <p className="mt-4 rounded-lg bg-[var(--crm-surface)] px-3 py-3 text-xs text-[var(--crm-text-muted)]">No AI changes are waiting for review.</p> : null}
      {proposals.length ? <div className="mt-4 space-y-3">{proposals.map((proposal) => (
        <AiChangeProposalCard key={proposal.id} proposal={proposal} onDecision={(decision) => decide(proposal, decision)} />
      ))}</div> : null}
    </section>
  )
}
