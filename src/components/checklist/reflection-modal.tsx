'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface ReflectionModalProps {
  open: boolean
  onClose: () => void
  teamMember?: string
}

export function ReflectionModal({ open, onClose, teamMember = 'Ernest' }: ReflectionModalProps) {
  const [unexpected, setUnexpected] = useState('')
  const [wentRight, setWentRight] = useState('')
  const [lesson, setLesson] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  if (!open) return null

  async function handleSubmit() {
    setSubmitting(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unexpected,
          went_right: wentRight,
          lesson_learned: lesson,
          team_member: teamMember,
          checklist_items: [],
        }),
      })
      const data = await res.json()
      if (data.success) {
        setStatus('success')
        // EOD-02: Trigger Mojo metrics refresh on successful EOD submission
        fetch('/api/mojo-kpis').catch(() => {})
        setTimeout(() => {
          onClose()
          setUnexpected('')
          setWentRight('')
          setLesson('')
          setStatus('idle')
        }, 1500)
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-primary/10 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-surface-container-lowest rounded-xl shadow-[0_20px_50px_rgba(10,20,34,0.15)] overflow-hidden border border-outline-variant/15">
        {/* Header */}
        <div className="px-6 sm:px-8 pt-8 sm:pt-10 pb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4 bg-tertiary-container text-on-tertiary-container">
            <Icon name="bedtime" className="text-2xl" />
          </div>
          <h2 className="text-2xl font-black text-primary tracking-tight mb-2">End of Day Reflection</h2>
          <p className="text-on-surface-variant text-sm px-4">
            Complete these three quick reflections to close your loop for the day.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 sm:px-8 pb-8 sm:pb-10 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-primary uppercase tracking-wider">
              What was unexpected?
            </label>
            <p className="text-xs text-on-surface-variant italic mb-1">Something that took you for a loop</p>
            <textarea
              value={unexpected}
              onChange={(e) => setUnexpected(e.target.value)}
              className="w-full bg-surface-container-low border-0 rounded-lg p-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-outline/40"
              placeholder="Describe any surprises or shifts in your workflow today..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-primary uppercase tracking-wider">
              What went right?
            </label>
            <p className="text-xs text-on-surface-variant italic mb-1">Successes or loops you closed today</p>
            <textarea
              value={wentRight}
              onChange={(e) => setWentRight(e.target.value)}
              className="w-full bg-surface-container-low border-0 rounded-lg p-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-outline/40"
              placeholder="List your wins or tasks finalized..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-primary uppercase tracking-wider">
              Lesson learned?
            </label>
            <p className="text-xs text-on-surface-variant italic mb-1">What will you do better tomorrow?</p>
            <textarea
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              className="w-full bg-surface-container-low border-0 rounded-lg p-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-outline/40"
              placeholder="Identify one architectural improvement for your process..."
              rows={3}
            />
          </div>

          {status === 'success' && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold">
              <Icon name="check_circle" size="text-lg" />
              EOD submitted! Casey has been notified.
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-2 text-red-500 text-sm font-semibold">
              <Icon name="error" size="text-lg" />
              Submission failed. Please try again.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 py-5 bg-surface-container-low flex flex-row-reverse gap-3">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:bg-primary-container transition-all active:scale-[0.98] shadow-lg shadow-primary/10 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit Protocol'}
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-6 py-3 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-highest rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
