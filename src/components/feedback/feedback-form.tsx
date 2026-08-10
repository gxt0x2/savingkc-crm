'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface Props {
  defaultSection?: string
  onClose: () => void
  onSubmit: () => void
}

const SECTIONS = ['Dashboard', 'Contacts', 'Lead details', 'Conversations', 'Dialer', 'Calendar', 'Tasks', 'Reports', 'Dispositions / Closing', 'Google Ads', 'Workflows', 'ARI Insights', 'AI Assistant', 'Settings', 'Integrations', 'Other']

export function FeedbackForm({ defaultSection = '', onClose, onSubmit }: Props) {
  const [type, setType] = useState<'bug' | 'feature' | 'feedback'>('bug')
  const [section, setSection] = useState(defaultSection)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          section,
          description,
          priority,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'The Andon could not be submitted. Please try again.')
      }
      onSubmit()
      onClose()
    } catch (err) {
      console.error('Failed to submit feedback:', err)
      setError(err instanceof Error ? err.message : 'The Andon could not be submitted. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="andon-title" className="crm-panel max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-6 text-[var(--crm-ink)] shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]"><Icon name="warning_amber" className="text-[24px]" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-danger)]">System Andon</p><h2 id="andon-title" className="text-xl font-black">Report an issue</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Stop, flag, and route anything blocking good work.</p></div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Andon form"
            className="crm-icon-button flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          >
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              What needs attention?
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['bug', 'feature', 'feedback'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-lg border px-3 py-3 text-sm font-semibold transition-colors ${
                    type === t
                      ? 'border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
                      : 'border-[var(--crm-border)] bg-[var(--crm-surface)] hover:border-[var(--crm-border-strong)]'
                  }`}
                >
                  <Icon
                    name={t === 'bug' ? 'bug_report' : t === 'feature' ? 'lightbulb' : 'chat'}
                    size="text-base"
                    className="inline mr-1.5"
                  />
                  {t === 'bug' ? 'System issue' : t === 'feature' ? 'Improvement' : 'Data concern'}
                </button>
              ))}
            </div>
          </div>

          {/* Section */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              Area
            </label>
            <select
              aria-label="Area"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              required
              className="crm-field h-11 w-full rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25"
            >
              <option value="">Select section...</option>
              {SECTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              Impact
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                    priority === p
                      ? 'border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
                      : 'border-[var(--crm-border)] hover:border-[var(--crm-border-strong)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              What happened?
            </label>
            <textarea
              aria-label="What happened"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={6}
              placeholder={
                type === 'bug'
                  ? 'What happened? What were you trying to do? What did you expect to happen?'
                  : type === 'feature'
                  ? "Describe the feature you'd like to see. What problem does it solve?"
                  : 'Share your thoughts, suggestions, or general feedback.'
              }
              className="crm-field w-full resize-y rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25"
            />
          </div>

          {/* Auto-captured info note */}
          <div className="rounded-lg bg-[var(--crm-surface-subtle)] p-3 text-xs text-[var(--crm-text-muted)]">
            <Icon name="info" size="text-sm" className="inline mr-1" />
            <strong>Included automatically:</strong> Current page, timestamp, signed-in agent, and browser information.
          </div>

          {error ? <div role="alert" className="rounded-lg border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</div> : null}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="crm-secondary-button flex-1 rounded-xl px-6 py-3 text-sm font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !description.trim() || !section}
              className="flex-1 rounded-xl bg-[var(--crm-danger)] px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-95 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Sending Andon…' : 'Raise Andon'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
