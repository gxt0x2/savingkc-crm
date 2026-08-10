'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import {
  ANDON_CASCADES,
  ANDON_ISSUE_KINDS,
  ANDON_KIND_LABELS,
  type AndonIssueKind,
  type AndonPriority,
} from '@/lib/andon'

interface Props {
  defaultSection?: string
  onClose: () => void
  onSubmit: () => void
}

const KIND_ICONS: Record<AndonIssueKind, string> = {
  process: 'account_tree',
  system: 'bug_report',
  data: 'database',
  improvement: 'lightbulb',
}

function defaultsForContext(context: string): { kind: AndonIssueKind; workstream: string; category: string } {
  if (context === 'Google Ads') return { kind: 'process', workstream: 'Marketing', category: 'Google Ads' }
  if (context === 'Dispositions / Closing') return { kind: 'process', workstream: 'Dispositions', category: 'Transaction coordination' }
  if (['Contacts', 'Lead details', 'Conversations', 'Dialer', 'Calendar', 'Tasks'].includes(context)) {
    return { kind: 'process', workstream: 'Acquisitions', category: 'Lead intake and assignment' }
  }
  if (context === 'Workflows') return { kind: 'system', workstream: 'Workflows and automation', category: 'Trigger' }
  if (context === 'Integrations') return { kind: 'system', workstream: 'Integrations', category: 'Other integration' }
  if (['Dashboard', 'Reports'].includes(context)) return { kind: 'data', workstream: 'Reporting', category: 'Incorrect metric' }
  return { kind: 'system', workstream: 'CRM experience', category: 'Navigation or page' }
}

export function FeedbackForm({ defaultSection = '', onClose, onSubmit }: Props) {
  const initial = defaultsForContext(defaultSection)
  const [issueKind, setIssueKind] = useState<AndonIssueKind>(initial.kind)
  const [workstream, setWorkstream] = useState(initial.workstream)
  const [category, setCategory] = useState(initial.category)
  const [description, setDescription] = useState('')
  const [fiveWhys, setFiveWhys] = useState(['', '', '', '', ''])
  const [priority, setPriority] = useState<AndonPriority>('medium')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const workstreams = Object.keys(ANDON_CASCADES[issueKind])
  const categories = workstream ? ANDON_CASCADES[issueKind][workstream] ?? [] : []

  function chooseKind(nextKind: AndonIssueKind) {
    const nextWorkstream = Object.keys(ANDON_CASCADES[nextKind])[0] ?? ''
    setIssueKind(nextKind)
    setWorkstream(nextWorkstream)
    setCategory(nextWorkstream ? ANDON_CASCADES[nextKind][nextWorkstream]?.[0] ?? '' : '')
  }

  function chooseWorkstream(nextWorkstream: string) {
    setWorkstream(nextWorkstream)
    setCategory(ANDON_CASCADES[issueKind][nextWorkstream]?.[0] ?? '')
  }

  function updateWhy(index: number, value: string) {
    setFiveWhys((current) => current.map((why, whyIndex) => whyIndex === index ? value : why))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!description.trim() || !workstream || !category) return

    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue_kind: issueKind,
          department: workstream,
          category,
          description,
          five_whys: fiveWhys,
          priority,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'The Andon could not be submitted. Please try again.')
      }
      onSubmit()
      onClose()
    } catch (err) {
      console.error('Failed to submit Andon:', err)
      setError(err instanceof Error ? err.message : 'The Andon could not be submitted. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="andon-title" className="crm-panel max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 text-[var(--crm-ink)] shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]"><Icon name="warning_amber" className="text-[24px]" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-danger)]">System Andon</p><h2 id="andon-title" className="text-xl font-black">Report an issue</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Identify the issue, route it once, and preserve the root-cause trail.</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Andon form" className="crm-icon-button flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"><Icon name="close" size="text-lg" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset>
            <legend className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">1. What needs attention?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ANDON_ISSUE_KINDS.map((kind) => (
                <button key={kind} type="button" aria-pressed={issueKind === kind} onClick={() => chooseKind(kind)} className={`rounded-xl border px-2 py-3 text-xs font-bold transition-colors ${issueKind === kind ? 'border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)] hover:border-[var(--crm-border-strong)]'}`}>
                  <Icon name={KIND_ICONS[kind]} className="mr-1.5 inline text-[17px]" />{ANDON_KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              2. Core work area
              <select aria-label="Core work area" value={workstream} onChange={(event) => chooseWorkstream(event.target.value)} required className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25">
                {workstreams.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              3. Specific process
              <select aria-label="Specific process" value={category} onChange={(event) => setCategory(event.target.value)} required className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25">
                {categories.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">4. Impact</legend>
            <div className="grid grid-cols-4 gap-2">
              {(['low', 'medium', 'high', 'critical'] as const).map((level) => <button key={level} type="button" aria-pressed={priority === level} onClick={() => setPriority(level)} className={`rounded-lg border px-2 py-2 text-xs font-semibold capitalize transition-colors ${priority === level ? 'border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-border)] hover:border-[var(--crm-border-strong)]'}`}>{level}</button>)}
            </div>
          </fieldset>

          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
            5. What happened?
            <textarea aria-label="What happened" value={description} onChange={(event) => setDescription(event.target.value)} required rows={4} placeholder="What were you doing, what happened, and what should have happened?" className="crm-field mt-2 w-full resize-y rounded-lg px-3 py-2 text-sm font-medium normal-case tracking-normal outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25" />
          </label>

          <details className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3" open>
            <summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-[var(--crm-ink)]">6. Five Whys <span className="font-medium normal-case tracking-normal text-[var(--crm-text-muted)]">- add what is known now</span></summary>
            <p className="mb-3 mt-1 text-[11px] text-[var(--crm-text-muted)]">Each answer should explain the answer above it. Missing answers stay visible on the Andon dashboard for follow-up.</p>
            <div className="space-y-2">
              {fiveWhys.map((why, index) => <label key={index} className="grid items-center gap-2 text-xs font-bold sm:grid-cols-[58px_1fr]"><span>Why {index + 1}</span><input aria-label={`Why ${index + 1}`} value={why} onChange={(event) => updateWhy(index, event.target.value)} placeholder={index === 0 ? 'Why did it happen?' : 'Why was that true?'} className="crm-field h-9 rounded-lg px-3 text-xs font-medium" /></label>)}
            </div>
          </details>

          <div className="rounded-lg bg-[var(--crm-info-soft)] p-3 text-xs text-[var(--crm-text-muted)]"><Icon name="info" size="text-sm" className="mr-1 inline text-[var(--crm-info)]" /><strong>Included automatically:</strong> current page, timestamp, signed-in agent, and browser.</div>
          {error ? <div role="alert" className="rounded-lg border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</div> : null}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="crm-secondary-button flex-1 rounded-xl px-6 py-3 text-sm font-bold">Cancel</button>
            <button type="submit" disabled={loading || !description.trim() || !workstream || !category} className="flex-1 rounded-xl bg-[var(--crm-danger)] px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-95 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Sending Andon…' : 'Raise Andon'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
