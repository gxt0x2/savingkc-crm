'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCadenceDraft, ProspectingCadenceStep } from '@/lib/ai/prospecting-cadence'

type DraftResponse = {
  draft: ProspectingCadenceDraft
  generationId: string
  model: string | null
  approvalRequired: true
}

export function CampaignAiCadence({
  campaignName,
  currentSteps,
  onApply,
}: {
  campaignName: string
  currentSteps: ProspectingCadenceStep[]
  onApply: (steps: ProspectingCadenceStep[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<DraftResponse | null>(null)
  const [error, setError] = useState('')

  async function draftCadence() {
    setLoading(true)
    setError('')
    setProposal(null)
    try {
      const response = await fetch('/api/ai/prospecting-cadence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ campaignName, currentSteps }),
      })
      const payload = await response.json().catch(() => ({})) as Partial<DraftResponse> & { error?: string }
      if (!response.ok || !payload.draft || payload.approvalRequired !== true) throw new Error(payload.error || 'AI cadence drafting is unavailable.')
      setProposal(payload as DraftResponse)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI cadence drafting is unavailable.')
    } finally {
      setLoading(false)
    }
  }

  return <section className="rounded-2xl border border-[var(--crm-brand)]/25 bg-[var(--crm-brand-soft)]/40 p-4" aria-label="AI cadence assistant">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-xl">
        <div className="flex items-center gap-2"><Icon name="auto_awesome" className="text-lg text-[var(--crm-brand)]" /><p className="text-sm font-black text-[var(--crm-ink)]">AI cadence assistant</p></div>
        <p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Drafts a respectful sequence for review. It cannot change, activate, or send this campaign.</p>
      </div>
      <button type="button" disabled={loading || !campaignName.trim()} onClick={draftCadence} className="crm-secondary-button inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black disabled:opacity-40">
        <Icon name={loading ? 'progress_activity' : 'auto_awesome'} className={loading ? 'animate-spin text-base' : 'text-base'} />
        {loading ? 'Drafting…' : proposal ? 'Draft another' : 'Draft with AI'}
      </button>
    </div>
    {error ? <p role="alert" className="mt-3 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
    {proposal ? <div className="mt-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-black text-[var(--crm-ink)]">Saved AI draft</p><p className="mt-0.5 text-[10px] text-[var(--crm-text-muted)]">{proposal.model || 'AI model'} · review before applying</p></div><span className="rounded-full bg-[var(--crm-warning-soft)] px-2.5 py-1 text-[10px] font-black text-[var(--crm-warning)]">Not applied</span></div>
      <p className="mt-3 text-xs leading-5 text-[var(--crm-text-muted)]">{proposal.draft.rationale}</p>
      <ol className="mt-3 space-y-2">{proposal.draft.steps.map((step, index) => <li key={`${index}-${step.delayMinutes}`} className="flex gap-2 rounded-lg bg-[var(--crm-surface-subtle)] p-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--crm-brand)] text-[10px] font-black text-white">{index + 1}</span><div><p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{index === 0 ? 'Immediately' : `${Math.round(step.delayMinutes / 60)} hours after prior`}</p><p className="mt-1 text-xs leading-5 text-[var(--crm-ink)]">{step.bodyTemplate}</p></div></li>)}</ol>
      <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setProposal(null)} className="crm-secondary-button rounded-lg px-3 py-2 text-xs font-black">Discard</button><button type="button" onClick={() => { onApply(proposal.draft.steps.map((step) => ({ ...step }))); setProposal(null) }} className="crm-primary-button inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-black"><Icon name="check" className="text-base" />Apply draft</button></div>
    </div> : null}
  </section>
}
