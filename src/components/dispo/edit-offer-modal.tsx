'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useIsAdmin } from '@/hooks/use-is-admin'
import type { BuyerOffer } from '@/types/dispo'

interface Props {
  offer: BuyerOffer
  onClose: () => void
  onSaved: () => void
  onDeleted?: () => void
}

export function EditOfferModal({ offer, onClose, onSaved, onDeleted }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { isAdmin } = useIsAdmin()

  const [form, setForm] = useState({
    offer_amount: String(offer.offer_amount ?? ''),
    earnest_money: offer.earnest_money != null ? String(offer.earnest_money) : '',
    financing_type: offer.financing_type ?? 'cash',
    close_days: offer.close_days != null ? String(offer.close_days) : '',
    inspection_days: offer.inspection_days != null ? String(offer.inspection_days) : '',
    status: offer.status,
    notes: offer.notes ?? '',
  })

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.offer_amount || isNaN(Number(form.offer_amount))) {
      setError('Offer amount is required')
      return
    }
    setSubmitting(true)
    try {
      const body = {
        offer_amount: Number(form.offer_amount),
        earnest_money: form.earnest_money === '' ? null : Number(form.earnest_money),
        financing_type: form.financing_type || null,
        close_days: form.close_days === '' ? null : Number(form.close_days),
        inspection_days: form.inspection_days === '' ? null : Number(form.inspection_days),
        status: form.status,
        notes: form.notes || null,
      }
      const res = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update offer')
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update offer')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    const buyerName = offer.buyer?.name || 'this buyer'
    const propertyAddress = offer.lead?.property_address || 'this property'
    const ok = window.confirm(
      `Permanently delete this offer from ${buyerName} on ${propertyAddress}? This cannot be undone.`
    )
    if (!ok) return

    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/offers/${offer.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete offer')
      }
      if (onDeleted) onDeleted()
      else onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete offer')
    } finally {
      setDeleting(false)
    }
  }

  const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 focus:border-[#E32E2E]/60 transition-colors bg-white'
  const label = 'block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Edit Offer</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {offer.buyer?.name || 'Buyer'} · {offer.lead?.property_address || 'Property'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg text-slate-500">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Offer Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  required
                  min={1}
                  className={`${input} pl-6`}
                  value={form.offer_amount}
                  onChange={e => set('offer_amount', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={label}>Earnest Money</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  className={`${input} pl-6`}
                  value={form.earnest_money}
                  onChange={e => set('earnest_money', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={label}>Financing</label>
              <select className={input} value={form.financing_type} onChange={e => set('financing_type', e.target.value)}>
                <option value="cash">Cash</option>
                <option value="hard_money">Hard Money</option>
                <option value="private_money">Private Money</option>
                <option value="conventional">Conventional</option>
              </select>
            </div>
            <div>
              <label className={label}>Status</label>
              <select className={input} value={form.status} onChange={e => set('status', e.target.value as BuyerOffer['status'])}>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="reviewing">Reviewing</option>
                <option value="countered">Countered</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div>
              <label className={label}>Close Days</label>
              <input type="number" min={1} className={input} value={form.close_days} onChange={e => set('close_days', e.target.value)} />
            </div>
            <div>
              <label className={label}>Inspection Days</label>
              <input type="number" min={0} className={input} value={form.inspection_days} onChange={e => set('inspection_days', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={label}>Notes</label>
            <textarea
              rows={3}
              className={`${input} resize-none`}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
          <div>
            {isAdmin && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || submitting}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E32E2E] hover:bg-[#E32E2E]/10 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
                title="Delete this offer"
              >
                <Icon name="delete" size="text-base" />
                {deleting ? 'Deleting…' : 'Delete Offer'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || deleting}
              className="bg-[#E32E2E] hover:bg-[#c72626] text-white text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
