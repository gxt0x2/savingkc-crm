'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import type { BuyerOffer } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBadge(status: BuyerOffer['status']) {
  const map: Record<BuyerOffer['status'], string> = {
    submitted: 'bg-blue-100 text-blue-700',
    reviewing: 'bg-yellow-100 text-yellow-700',
    countered: 'bg-purple-100 text-purple-700',
    accepted: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    withdrawn: 'bg-slate-100 text-slate-500',
  }
  return map[status] ?? 'bg-slate-100 text-slate-500'
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Counter Offer Modal
// ---------------------------------------------------------------------------
function CounterModal({
  offer,
  onClose,
  onCountered,
}: {
  offer: BuyerOffer
  onClose: () => void
  onCountered: () => void
}) {
  const [amount, setAmount] = useState(String(offer.offer_amount))
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || isNaN(Number(amount))) { setError('Enter a valid counter amount'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'countered', counter_amount: Number(amount), counter_notes: notes || null }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to counter offer')
      }
      onCountered()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Counter Offer</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <p className="text-slate-500">Original offer: <span className="font-bold text-slate-900">{formatCurrency(offer.offer_amount)}</span></p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Counter Amount *</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 text-sm font-semibold">$</span>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg pl-7 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="150000"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason for counter..."
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send Counter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm Dialog
// ---------------------------------------------------------------------------
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmClass,
  withReason,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmClass: string
  withReason?: boolean
  onConfirm: (reason?: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-2">{title}</h2>
        <p className="text-sm text-slate-600 mb-4">{message}</p>
        {withReason && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (optional)</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason for rejection..."
            />
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason || undefined)}
            className={cn('flex-1 rounded-lg px-4 py-2 text-sm font-semibold', confirmClass)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Offer Detail Row (expanded)
// ---------------------------------------------------------------------------
function OfferDetail({
  offer,
  onAction,
}: {
  offer: BuyerOffer
  onAction: (offerId: string, newStatus: BuyerOffer['status'], extra?: Record<string, unknown>) => void
}) {
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null)
  const [showCounter, setShowCounter] = useState(false)

  const buyer = offer.buyer
  const lead = offer.lead

  async function handleAccept() {
    await onAction(offer.id, 'accepted')
    setConfirm(null)
  }

  async function handleReject(reason?: string) {
    await onAction(offer.id, 'rejected', reason ? { counter_notes: reason } : undefined)
    setConfirm(null)
  }

  const canAct = !['accepted', 'rejected', 'withdrawn'].includes(offer.status)

  return (
    <>
      {confirm === 'accept' && (
        <ConfirmDialog
          title="Accept Offer?"
          message={`Accept ${buyer ? `${buyer.first_name} ${buyer.last_name}'s` : 'this'} offer of ${formatCurrency(offer.offer_amount)}? This cannot be undone.`}
          confirmLabel="Accept Offer"
          confirmClass="bg-emerald-600 text-white hover:bg-emerald-500"
          onConfirm={handleAccept}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reject' && (
        <ConfirmDialog
          title="Reject Offer?"
          message={`Reject ${buyer ? `${buyer.first_name} ${buyer.last_name}'s` : 'this'} offer of ${formatCurrency(offer.offer_amount)}?`}
          confirmLabel="Reject"
          confirmClass="bg-red-600 text-white hover:bg-red-500"
          withReason
          onConfirm={handleReject}
          onCancel={() => setConfirm(null)}
        />
      )}
      {showCounter && (
        <CounterModal
          offer={offer}
          onClose={() => setShowCounter(false)}
          onCountered={() => { setShowCounter(false); onAction(offer.id, 'countered') }}
        />
      )}

      <div className="bg-slate-50 border-t border-slate-100 px-4 py-4">
        <div className="max-w-2xl">
          {/* Detail grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Offer Amount', val: formatCurrency(offer.offer_amount) },
              { label: 'Close Days', val: offer.close_days != null ? `${offer.close_days} days` : '—' },
              { label: 'Inspection Days', val: offer.inspection_days != null ? `${offer.inspection_days} days` : '—' },
              { label: 'Earnest Money', val: offer.earnest_money != null ? formatCurrency(offer.earnest_money) : '—' },
              { label: 'Financing', val: offer.financing_type ?? '—' },
              { label: 'Contingencies', val: offer.contingencies ?? '—' },
              { label: 'Submitted', val: formatDate(offer.submitted_at) },
              { label: 'Decided', val: formatDate(offer.decided_at) },
            ].map(({ label, val }) => (
              <div key={label} className="bg-white rounded-lg p-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
                <p className="text-sm font-semibold text-slate-900">{val}</p>
              </div>
            ))}
          </div>

          {/* Counter info */}
          {offer.counter_amount != null && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
              <p className="text-xs font-bold text-purple-700 mb-1">Counter Offer: {formatCurrency(offer.counter_amount)}</p>
              {offer.counter_notes && <p className="text-xs text-purple-600">{offer.counter_notes}</p>}
            </div>
          )}

          {/* Notes */}
          {offer.notes && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
              <p className="text-xs font-bold text-slate-500 mb-1">Buyer Notes</p>
              <p className="text-sm text-slate-700">{offer.notes}</p>
            </div>
          )}

          {/* Buyer contact */}
          {buyer && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4 flex items-center gap-4">
              <div>
                <p className="text-xs font-bold text-slate-500 mb-0.5">Buyer</p>
                <p className="text-sm font-semibold text-slate-900">{buyer.first_name} {buyer.last_name}</p>
                {buyer.company_name && <p className="text-xs text-slate-500">{buyer.company_name}</p>}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                {buyer.phone && (
                  <a
                    href={`tel:${buyer.phone}`}
                    className="p-2 rounded-lg hover:bg-green-50 text-slate-400 hover:text-green-600 transition-colors"
                  >
                    <Icon name="call" size="text-base" />
                  </a>
                )}
                {buyer.email && (
                  <a
                    href={`mailto:${buyer.email}`}
                    className="p-2 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    <Icon name="mail" size="text-base" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Lead info */}
          {lead && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
              <p className="text-xs font-bold text-slate-500 mb-0.5">Property</p>
              <p className="text-sm font-semibold text-slate-900">{lead.property_address}</p>
              <p className="text-xs text-slate-500">{lead.full_name}</p>
            </div>
          )}

          {/* Action buttons */}
          {canAct && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setConfirm('accept')}
                className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                <Icon name="check_circle" size="text-sm" />
                Accept
              </button>
              <button
                onClick={() => setShowCounter(true)}
                className="flex items-center gap-1.5 bg-purple-600 text-white hover:bg-purple-500 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                <Icon name="swap_horizontal_circle" size="text-sm" />
                Counter
              </button>
              <button
                onClick={() => setConfirm('reject')}
                className="flex items-center gap-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                <Icon name="cancel" size="text-sm" />
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
const STATUS_FILTERS = [
  { val: '', label: 'All' },
  { val: 'submitted', label: 'Submitted' },
  { val: 'reviewing', label: 'Reviewing' },
  { val: 'countered', label: 'Countered' },
  { val: 'accepted', label: 'Accepted' },
  { val: 'rejected', label: 'Rejected' },
] as const

export default function OffersPage() {
  const [offers, setOffers] = useState<BuyerOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function fetchOffers() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/offers?${params}`)
      if (!res.ok) throw new Error('Failed to fetch offers')
      const data = await res.json()
      setOffers(data.offers ?? [])
    } catch {
      setError('Failed to load offers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOffers() }, [statusFilter])

  async function handleAction(
    offerId: string,
    newStatus: BuyerOffer['status'],
    extra?: Record<string, unknown>
  ) {
    try {
      const res = await fetch(`/api/offers/${offerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update offer')
      }
      setFeedback(`Offer ${newStatus}`)
      setTimeout(() => setFeedback(null), 2500)
      fetchOffers()
      if (newStatus === 'accepted' || newStatus === 'rejected') setExpandedId(null)
    } catch (err: unknown) {
      setFeedback(err instanceof Error ? err.message : 'Error updating offer')
    }
  }

  const filtered = statusFilter
    ? offers.filter(o => o.status === statusFilter)
    : offers

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-32 max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary mb-1">Offers</h1>
          <p className="text-slate-500 text-sm">
            {loading ? 'Loading…' : `${filtered.length} offer${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Status filters */}
      <div className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map(({ val, label }) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
              statusFilter === val
                ? 'bg-primary text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-slate-400 py-16 text-center">Loading offers...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="request_quote" className="text-5xl text-slate-200 mb-4" />
          <p className="text-slate-400 font-medium text-lg">No offers yet</p>
          <p className="text-slate-400 text-sm mt-1">
            {statusFilter ? `No ${statusFilter} offers found.` : 'Offers submitted through deal pages will appear here.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Deal Address</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Buyer</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Offer Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Close Days</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Financing</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Submitted</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(offer => (
                  <>
                    <tr
                      key={offer.id}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer',
                        expandedId === offer.id && 'bg-slate-50'
                      )}
                      onClick={() => setExpandedId(expandedId === offer.id ? null : offer.id)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {offer.lead?.property_address ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {offer.buyer ? `${offer.buyer.first_name} ${offer.buyer.last_name}` : '—'}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {formatCurrency(offer.offer_amount)}
                        {offer.counter_amount != null && (
                          <span className="ml-2 text-xs font-normal text-purple-600">
                            Counter: {formatCurrency(offer.counter_amount)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                        {offer.close_days != null ? `${offer.close_days}d` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {offer.financing_type ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize', statusBadge(offer.status))}>
                          {offer.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs hidden lg:table-cell whitespace-nowrap">
                        {formatDate(offer.submitted_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Icon
                          name={expandedId === offer.id ? 'expand_less' : 'expand_more'}
                          className="text-slate-400"
                        />
                      </td>
                    </tr>
                    {expandedId === offer.id && (
                      <tr key={`${offer.id}-detail`} className="border-b border-slate-100">
                        <td colSpan={8} className="p-0">
                          <OfferDetail offer={offer} onAction={handleAction} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl">
          {feedback}
        </div>
      )}
    </div>
  )
}
