'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface Props {
  leadId: string
  currentPhase: 1 | 2 | 3
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  nextActionDate?: string
  onUpdate: () => void
}

export function GhostProtocolControls({ leadId, currentPhase, status, nextActionDate, onUpdate }: Props) {
  const [showPauseDialog, setShowPauseDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [loading, setLoading] = useState(false)

  async function handlePause() {
    if (!pauseReason.trim()) return

    setLoading(true)
    try {
      const res = await fetch('/api/ghost-protocol/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, reason: pauseReason }),
      })

      if (res.ok) {
        setShowPauseDialog(false)
        setPauseReason('')
        onUpdate()
      }
    } catch (err) {
      console.error('Failed to pause ghost protocol:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleResume() {
    setLoading(true)
    try {
      const res = await fetch('/api/ghost-protocol/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      })

      if (res.ok) {
        onUpdate()
      }
    } catch (err) {
      console.error('Failed to resume ghost protocol:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    if (!cancelReason.trim()) return

    setLoading(true)
    try {
      const res = await fetch('/api/ghost-protocol/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, reason: cancelReason }),
      })

      if (res.ok) {
        setShowCancelDialog(false)
        setCancelReason('')
        onUpdate()
      }
    } catch (err) {
      console.error('Failed to cancel ghost protocol:', err)
    } finally {
      setLoading(false)
    }
  }

  const phaseLabels = {
    1: 'Phase 1: Days 1-7',
    2: 'Phase 2: Days 8-21',
    3: 'Phase 3: Long Nurture',
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
        <Icon name="auto_fix_high" size="text-base" />
        Ghost Protocol
      </h2>

      <div className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-between py-3 border-b border-outline-variant/10">
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Status</span>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                status === 'active'
                  ? 'bg-green-500'
                  : status === 'paused'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
              }`}
            />
            <span className="text-sm font-semibold capitalize">{status}</span>
          </div>
        </div>

        {/* Current Phase */}
        <div className="flex items-center justify-between py-3 border-b border-outline-variant/10">
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Phase</span>
          <span className="text-sm font-semibold">{phaseLabels[currentPhase]}</span>
        </div>

        {/* Next Action */}
        {nextActionDate && status === 'active' && (
          <div className="flex items-center justify-between py-3 border-b border-outline-variant/10">
            <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Next Action</span>
            <span className="text-sm font-semibold">
              {new Date(nextActionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2 pt-2">
          {status === 'active' && (
            <>
              <button
                onClick={() => setShowPauseDialog(true)}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                <Icon name="pause" size="text-sm" className="inline mr-1" />
                Pause
              </button>
              <button
                onClick={() => setShowCancelDialog(true)}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <Icon name="close" size="text-sm" className="inline mr-1" />
                Cancel
              </button>
            </>
          )}

          {status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-500 text-white text-sm font-semibold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              <Icon name="play_arrow" size="text-sm" className="inline mr-1" />
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Pause Dialog */}
      {showPauseDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Pause Ghost Protocol</h3>
            <p className="text-sm text-on-surface-variant mb-4">
              Why are you pausing? This helps track legitimate reasons vs process gaps.
            </p>

            <div className="space-y-2 mb-4">
              {['Traveling', 'Hospitalization', 'Family Situation', 'Other'].map((reason) => (
                <button
                  key={reason}
                  onClick={() => setPauseReason(reason)}
                  className={`w-full px-4 py-2 text-sm font-semibold rounded-lg border-2 transition-colors ${
                    pauseReason === reason
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            {pauseReason === 'Other' && (
              <input
                type="text"
                placeholder="Specify reason..."
                className="w-full px-3 py-2 border border-outline-variant/20 rounded-lg mb-4 text-sm"
                onChange={(e) => setPauseReason(e.target.value)}
              />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowPauseDialog(false)
                  setPauseReason('')
                }}
                className="flex-1 px-4 py-2 border border-outline-variant/20 rounded-lg font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handlePause}
                disabled={!pauseReason.trim() || loading}
                className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg font-semibold text-sm hover:bg-amber-600 disabled:opacity-50"
              >
                Pause Protocol
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Cancel Ghost Protocol</h3>
            <p className="text-sm text-on-surface-variant mb-4">
              Lead will stay in current stage. Why are you cancelling?
            </p>

            <div className="space-y-2 mb-4">
              {['Lead Reconnected', 'Not a Good Fit', 'Property Sold', 'Other'].map((reason) => (
                <button
                  key={reason}
                  onClick={() => setCancelReason(reason)}
                  className={`w-full px-4 py-2 text-sm font-semibold rounded-lg border-2 transition-colors ${
                    cancelReason === reason
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            {cancelReason === 'Other' && (
              <input
                type="text"
                placeholder="Specify reason..."
                className="w-full px-3 py-2 border border-outline-variant/20 rounded-lg mb-4 text-sm"
                onChange={(e) => setCancelReason(e.target.value)}
              />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCancelDialog(false)
                  setCancelReason('')
                }}
                className="flex-1 px-4 py-2 border border-outline-variant/20 rounded-lg font-semibold text-sm"
              >
                Back
              </button>
              <button
                onClick={handleCancel}
                disabled={!cancelReason.trim() || loading}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg font-semibold text-sm hover:bg-red-600 disabled:opacity-50"
              >
                Cancel Protocol
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
