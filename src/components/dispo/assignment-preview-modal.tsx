'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { BuyerOffer } from '@/types/dispo'

// Two-step flow so the user sees the actual filled DocuSeal contract before
// the buyer ever gets an email:
//   1. On open, POST /api/offers/:id/assignment — creates a DocuSeal
//      submission with send_email:false and returns the Assignee's
//      embed_src. We iframe it as the preview.
//   2. User clicks "Send to Buyer" → POST .../send to trigger the email.
//      User clicks "Cancel" → DELETE to archive the DocuSeal submission.
interface Props {
  offer: BuyerOffer
  onClose: () => void
  onSent: () => void
}

export function AssignmentPreviewModal({ offer, onClose, onSent }: Props) {
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    submissionId: number
    embedSrc: string | null
    assigneeEmail: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/offers/${offer.id}/assignment`, { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to generate preview')
        if (!cancelled) {
          setPreview({
            submissionId: data.submissionId,
            embedSrc: data.assignee?.embedSrc ?? null,
            assigneeEmail: data.assignee?.email ?? null,
          })
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to generate preview')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [offer.id])

  async function handleCancel() {
    try {
      await fetch(`/api/offers/${offer.id}/assignment`, { method: 'DELETE' })
    } catch {
      // Best-effort cleanup — close anyway
    }
    onClose()
  }

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/offers/${offer.id}/assignment/send`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      onSent()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4"
      onClick={handleCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[var(--ck-surface)] border border-[var(--ck-border)] rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] max-h-[1000px] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ck-border)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--ck-text)]">Send Assignment Contract</h2>
            <p className="text-xs text-[var(--ck-text-muted)] mt-0.5">
              {offer.buyer?.name || 'Buyer'} · {offer.lead?.property_address || 'Property'}
              {preview?.assigneeEmail && (
                <span className="ml-2">· will email {preview.assigneeEmail}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-hi)]"
          >
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden bg-white relative">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              <Icon name="hourglass_top" size="text-xl" className="mr-2 animate-spin" />
              Generating preview…
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-8">
              <div className="bg-[#E32E2E]/10 border border-[#E32E2E]/40 text-[var(--ck-accent-bright)] rounded-lg px-4 py-3 max-w-md">
                {error}
              </div>
            </div>
          ) : preview?.embedSrc ? (
            <>
              <iframe
                src={preview.embedSrc}
                title="Assignment preview"
                className="w-full h-full border-0"
              />
              <a
                href={preview.embedSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-3 right-3 inline-flex items-center gap-1.5 bg-[var(--ck-surface)] border border-[var(--ck-border-strong)] hover:border-[#E32E2E]/50 text-[var(--ck-text)] hover:text-[var(--ck-accent-bright)] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors shadow-lg"
                title="Open in a new tab for a larger view"
              >
                <Icon name="open_in_new" size="text-sm" />
                Full view
              </a>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm p-8">
              Preview unavailable — open directly in DocuSeal to verify.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
          <p className="text-xs text-[var(--ck-text-muted)]">
            Review the contract above. Clicking Send will email the buyer a signing link.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="text-sm font-semibold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || sending || !!error}
              className="flex items-center gap-2 bg-[#E32E2E] hover:bg-[#c72626] text-white text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              <Icon name="send" size="text-sm" />
              {sending ? 'Sending…' : 'Send to Buyer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
