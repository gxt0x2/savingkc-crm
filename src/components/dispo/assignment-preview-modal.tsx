'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { BuyerOffer } from '@/types/dispo'

// Two-step flow:
//   1. On open, POST /api/offers/:id/assignment — creates a DocuSeal
//      submission with send_email:false. We iframe the Assignor's embed_src
//      so the user (Ernest) signs as Assignor first.
//   2. After signing, click "Send to Buyer" → POST .../send to trigger the
//      Assignee email invite. Click "Cancel" → DELETE to archive.
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
            embedSrc: data.assignor?.embedSrc ?? null,
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
        className="bg-[var(--crm-surface)] border border-[var(--crm-border)] rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] max-h-[1000px] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--crm-border)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--crm-ink)]">Send Assignment Contract</h2>
            <p className="text-xs text-[var(--crm-text-muted)] mt-0.5">
              {offer.buyer?.name || 'Buyer'} · {offer.lead?.property_address || 'Property'}
              {preview?.assigneeEmail && (
                <span className="ml-2">· will email {preview.assigneeEmail}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]"
          >
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden bg-[var(--crm-surface)] relative">
          {loading ? (
            <div className="h-full flex items-center justify-center text-[var(--crm-text-muted)] text-sm">
              <Icon name="hourglass_top" size="text-xl" className="mr-2 animate-spin" />
              Generating preview…
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-8">
              <div className="bg-[var(--crm-brand)]/10 border border-[var(--crm-brand)]/40 text-[var(--crm-brand)] rounded-lg px-4 py-3 max-w-md">
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
                className="absolute top-3 right-3 inline-flex items-center gap-1.5 bg-[var(--crm-surface)] border border-[var(--crm-border-strong)] hover:border-[var(--crm-brand)]/50 text-[var(--crm-ink)] hover:text-[var(--crm-brand)] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors shadow-lg"
                title="Open in a new tab for a larger view"
              >
                <Icon name="open_in_new" size="text-sm" />
                Full view
              </a>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-[var(--crm-text-muted)] text-sm p-8">
              Preview unavailable — open directly in DocuSeal to verify.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-[var(--crm-border)] bg-[var(--crm-surface-raised)]">
          <p className="text-xs text-[var(--crm-text-muted)]">
            Sign as Assignor above. Clicking Send will email the buyer their signing link.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="text-sm font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)] px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || sending || !!error}
              className="flex items-center gap-2 bg-[var(--crm-brand)] hover:bg-[var(--crm-brand-hover)] text-[var(--crm-on-brand)] text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
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
