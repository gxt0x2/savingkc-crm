'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface Props {
  onClose: () => void
  onSubmit: () => void
}

export function FeedbackForm({ onClose, onSubmit }: Props) {
  const [type, setType] = useState<'bug' | 'feature' | 'feedback'>('bug')
  const [section, setSection] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return

    setLoading(true)
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

      if (res.ok) {
        onSubmit()
        onClose()
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-primary">Report Issue / Request Feature</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type */}
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
              Type
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['bug', 'feature', 'feedback'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-4 py-3 text-sm font-semibold rounded-lg border-2 transition-colors capitalize ${
                    type === t
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  }`}
                >
                  <Icon
                    name={t === 'bug' ? 'bug_report' : t === 'feature' ? 'lightbulb' : 'chat'}
                    size="text-base"
                    className="inline mr-1.5"
                  />
                  {t === 'bug' ? 'Bug Report' : t === 'feature' ? 'Feature Request' : 'Feedback'}
                </button>
              ))}
            </div>
          </div>

          {/* Section */}
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
              Section
            </label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              required
              className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
            >
              <option value="">Select section...</option>
              <option value="Leads">Leads</option>
              <option value="Pipeline">Pipeline</option>
              <option value="Conversations">Conversations</option>
              <option value="Calendar">Calendar</option>
              <option value="Dashboard">Dashboard</option>
              <option value="Ari">Ari</option>
              <option value="Settings">Settings</option>
              <option value="Integrations">Integrations</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
              Priority (Your Assessment)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border-2 transition-colors capitalize ${
                    priority === p
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={6}
              placeholder={
                type === 'bug'
                  ? 'What happened? What were you trying to do? What did you expect to happen?'
                  : type === 'feature'
                  ? 'Describe the feature you'd like to see. What problem does it solve?'
                  : 'Share your thoughts, suggestions, or general feedback.'
              }
              className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Auto-captured info note */}
          <div className="bg-surface-container rounded-lg p-3 text-xs text-on-surface-variant">
            <Icon name="info" size="text-sm" className="inline mr-1" />
            <strong>Auto-captured:</strong> Current page URL, timestamp, your name, browser info
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-outline-variant/20 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !description.trim() || !section}
              className="flex-1 px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
