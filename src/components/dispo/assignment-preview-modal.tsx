'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatCurrency } from '@/lib/utils'
import type { BuyerOffer } from '@/types/dispo'

function formatContractDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

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
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={handleCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[var(--ck-surface)] border border-[var(--ck-border)] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col"
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

        <div className="flex-1 overflow-y-auto bg-[var(--ck-bg)] px-6 py-5 text-sm">
          {loading ? (
            <div className="h-full flex items-center justify-center text-[var(--ck-text-muted)]">
              <Icon name="hourglass_top" size="text-xl" className="mr-2 animate-spin" />
              Generating preview…
            </div>
          ) : error ? (
            <div className="bg-[#E32E2E]/10 border border-[#E32E2E]/40 text-[var(--ck-accent-bright)] rounded-lg px-4 py-3">
              {error}
            </div>
          ) : (() => {
            const today = new Date().toISOString().slice(0, 10)
            const closeDays = offer.close_days ?? 0
            const closing = new Date(Date.now() + closeDays * 86_400_000).toISOString().slice(0, 10)
            const address = [offer.lead?.property_address].filter(Boolean).join('')
            const assigneeName = offer.buyer?.name || offer.buyer?.company || 'Buyer'
            const assigneeEntity = offer.buyer?.company || offer.buyer?.name || 'Buyer'
            const rows: { label: string; value: string; signer: 'Assignor' | 'Assignee' | 'Both' | 'Buyer fills' }[] = [
              { label: 'Assignee Name (header)', value: assigneeName, signer: 'Assignor' },
              { label: 'Property Address', value: address || '—', signer: 'Assignor' },
              { label: 'Effective Date', value: formatContractDate(today), signer: 'Assignor' },
              { label: 'Purchase Price', value: formatCurrency(offer.offer_amount), signer: 'Assignor' },
              { label: 'Closing Date', value: formatContractDate(closing), signer: 'Assignor' },
              { label: 'Assignee Entity', value: assigneeEntity, signer: 'Assignee' },
              { label: 'Printed Name', value: assigneeName, signer: 'Assignee' },
              { label: 'Email', value: offer.buyer?.email || '—', signer: 'Assignee' },
              { label: 'Phone', value: offer.buyer?.phone || '—', signer: 'Buyer fills' },
              { label: 'Title', value: '', signer: 'Buyer fills' },
              { label: 'Initials / Signatures / Signature Dates', value: '', signer: 'Both' },
            ]
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-[var(--ck-text)]">
                  <Icon name="info" size="text-lg" className="text-amber-400 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    DocuSeal blocks inline preview from external origins, so the full rendered contract opens in a new tab. Use the table below to sanity-check the prefill, then open the full preview before sending.
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--ck-border)] overflow-hidden">
                  <div className="grid grid-cols-[1fr_1.4fr_auto] gap-0 text-[11px] font-bold uppercase tracking-wider bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] px-4 py-2">
                    <div>Field</div>
                    <div>Prefilled value</div>
                    <div>Who</div>
                  </div>
                  {rows.map((r, i) => (
                    <div
                      key={r.label}
                      className={`grid grid-cols-[1fr_1.4fr_auto] gap-0 px-4 py-2.5 text-[var(--ck-text)] ${i % 2 === 0 ? 'bg-[var(--ck-surface)]' : 'bg-[var(--ck-surface-elev)]'}`}
                    >
                      <div className="text-[var(--ck-text-muted)] text-xs pr-3">{r.label}</div>
                      <div className={`text-sm font-semibold pr-3 ${r.value ? '' : 'text-[var(--ck-text-dim)] italic font-normal'}`}>
                        {r.value || 'buyer fills at signing'}
                      </div>
                      <div className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase">{r.signer}</div>
                    </div>
                  ))}
                </div>

                {preview?.embedSrc && (
                  <a
                    href={preview.embedSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[var(--ck-surface-elev)] border border-[var(--ck-border-strong)] hover:border-[#E32E2E]/50 hover:text-[var(--ck-accent-bright)] text-[var(--ck-text)] rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
                  >
                    <Icon name="open_in_new" size="text-base" />
                    Open full contract preview in new tab
                  </a>
                )}
              </div>
            )
          })()}
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
