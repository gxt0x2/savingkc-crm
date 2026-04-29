'use client'

import { Fragment, useState, useEffect } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import type { BuyerOffer } from '@/types/dispo'
import { NewOfferModal } from '@/components/dispo/new-offer-modal'
import { EditOfferModal } from '@/components/dispo/edit-offer-modal'
import { AssignmentPreviewModal } from '@/components/dispo/assignment-preview-modal'
import { DocumentManager } from '@/components/documents/document-manager'

// Score an offer 0-100 on how well it aligns with our goals (clean, fast,
// well-priced close) and the seller's (hit or beat asking). Weights:
//   Price 40 · Financing 25 · Close speed 20 · Earnest money 10 · Inspection 5
// `groupMaxAmount` anchors relative price within the same property when no
// asking price is set; `askingPrice` (from deal_pages) is preferred when
// available.
function scoreOffer(
  offer: BuyerOffer,
  groupMaxAmount: number,
  askingPrice: number | null | undefined
): { total: number; breakdown: { label: string; points: number; detail: string }[] } {
  const priceAnchor = askingPrice && askingPrice > 0 ? askingPrice : groupMaxAmount
  const pricePct = priceAnchor > 0 ? offer.offer_amount / priceAnchor : 0
  // Cap at 110% of anchor getting full 40 pts; scale below
  const pricePts = Math.max(0, Math.min(40, Math.round((pricePct / 1.1) * 40)))

  const financingMap: Record<string, number> = {
    cash: 25,
    hard_money: 18,
    private_money: 15,
    conventional: 8,
  }
  const financingPts = financingMap[offer.financing_type ?? ''] ?? 6
  const financingDetail = offer.financing_type ? offer.financing_type.replace('_', ' ') : 'unknown'

  const days = offer.close_days
  let closePts = 8
  if (days != null) {
    if (days <= 7) closePts = 20
    else if (days <= 14) closePts = 16
    else if (days <= 21) closePts = 12
    else if (days <= 30) closePts = 8
    else closePts = 4
  }

  const emPct = offer.earnest_money && offer.offer_amount > 0
    ? offer.earnest_money / offer.offer_amount
    : 0
  let earnestPts = 2
  if (emPct >= 0.05) earnestPts = 10
  else if (emPct >= 0.02) earnestPts = 8
  else if (emPct >= 0.01) earnestPts = 5
  else if (emPct > 0) earnestPts = 3

  const insp = offer.inspection_days
  let inspPts = 2
  if (insp != null) {
    if (insp === 0) inspPts = 5
    else if (insp <= 5) inspPts = 4
    else if (insp <= 10) inspPts = 3
    else if (insp <= 14) inspPts = 2
    else inspPts = 1
  }

  return {
    total: pricePts + financingPts + closePts + earnestPts + inspPts,
    breakdown: [
      { label: 'Price', points: pricePts, detail: `${Math.round(pricePct * 100)}% of ${askingPrice ? 'ask' : 'top bid'}` },
      { label: 'Financing', points: financingPts, detail: financingDetail },
      { label: 'Close speed', points: closePts, detail: days != null ? `${days}d` : 'n/a' },
      { label: 'Earnest money', points: earnestPts, detail: emPct > 0 ? `${(emPct * 100).toFixed(1)}%` : 'none' },
      { label: 'Inspection', points: inspPts, detail: insp != null ? `${insp}d` : 'n/a' },
    ],
  }
}

// Group offers by property (lead_id). Within each group, the starred offer
// is decided by manual `is_top_pick` override if set, else the highest
// scoreOffer() result. Offers inside each group sort by score desc; groups
// sort by most recent activity so the hottest property rises.
function groupOffersByProperty(offers: BuyerOffer[]) {
  const byLead = new Map<string, { lead: BuyerOffer['lead']; offers: BuyerOffer[]; askingPrice: number | null }>()
  for (const offer of offers) {
    if (!byLead.has(offer.lead_id)) {
      byLead.set(offer.lead_id, {
        lead: offer.lead,
        offers: [],
        askingPrice: offer.deal_page?.asking_price ?? null,
      })
    }
    byLead.get(offer.lead_id)!.offers.push(offer)
  }
  const groups = Array.from(byLead.values()).map(g => {
    const maxAmount = Math.max(...g.offers.map(o => o.offer_amount))
    const withScores = g.offers.map(offer => ({
      offer,
      score: scoreOffer(offer, maxAmount, g.askingPrice),
    }))
    withScores.sort((a, b) => b.score.total - a.score.total)
    const manualTop = withScores.find(x => x.offer.is_top_pick)
    const topId = manualTop ? manualTop.offer.id : withScores[0]?.offer.id ?? null
    return {
      lead: g.lead,
      askingPrice: g.askingPrice,
      scored: withScores,
      topId,
      isManualTop: Boolean(manualTop),
    }
  })
  groups.sort((a, b) => {
    const aNewest = Math.max(...a.scored.map(s => new Date(s.offer.submitted_at).getTime()))
    const bNewest = Math.max(...b.scored.map(s => new Date(s.offer.submitted_at).getTime()))
    return bNewest - aNewest
  })
  return groups
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBadge(status: BuyerOffer['status']) {
  const map: Record<BuyerOffer['status'], string> = {
    pending: 'bg-fuchsia-500/20 text-fuchsia-400',
    submitted: 'bg-amber-500/20 text-amber-300',
    reviewing: 'bg-yellow-500/20 text-yellow-400',
    countered: 'bg-purple-500/20 text-purple-400',
    accepted: 'bg-emerald-500/20 text-emerald-400',
    rejected: 'bg-[#E32E2E]/20 text-[#f87171]',
    withdrawn: 'bg-zinc-500/20 text-zinc-400',
    expired: 'bg-orange-500/20 text-orange-400',
  }
  return map[status] ?? 'bg-slate-500/25 text-slate-300'
}

// Assignment state → high-contrast pill. Dark-theme friendly: brand red
// for "Signed", amber for "Sent", slate outline for "Not sent".
function assignmentBadge(offer: BuyerOffer): { label: string; className: string; icon: string } | null {
  if (offer.assignment_signed_at) {
    return {
      label: 'Assignment Signed',
      className: 'bg-[#E32E2E] text-white border border-[#E32E2E] shadow-[0_0_0_1px_rgba(227,46,46,0.3)]',
      icon: 'verified',
    }
  }
  if (offer.assignment_sent_at) {
    return {
      label: 'Assignment Sent',
      className: 'bg-amber-400/25 text-amber-300 border border-amber-400/50',
      icon: 'outgoing_mail',
    }
  }
  if (offer.status === 'accepted') {
    return {
      label: 'Assignment Not Sent',
      className: 'bg-transparent text-[var(--ck-text-muted)] border border-dashed border-[var(--ck-border-strong)]',
      icon: 'description',
    }
  }
  return null
}

function tcBadge(offer: BuyerOffer): { label: string; className: string } | null {
  if (!offer.tc_file) return null
  return {
    label: `TC ${offer.tc_file.status.replace(/_/g, ' ')}`,
    className: offer.tc_file.risk_level === 'blocked'
      ? 'bg-[#E32E2E]/15 text-[#E32E2E] border border-[#E32E2E]/40'
      : offer.tc_file.risk_level === 'urgent'
        ? 'bg-orange-500/15 text-orange-500 border border-orange-500/40'
        : 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30',
  }
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
                className="w-full border border-slate-200 rounded-lg pl-7 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 focus:border-[#E32E2E]/60"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="150000"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 focus:border-[#E32E2E]/60 resize-none"
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
              className="flex-1 bg-[var(--ck-warn)] text-[#0a0a0a] hover:opacity-90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 transition-opacity"
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
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 focus:border-[#E32E2E]/60 resize-none"
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
  onEdited,
  onStartAssignment,
}: {
  offer: BuyerOffer
  onAction: (offerId: string, newStatus: BuyerOffer['status'], extra?: Record<string, unknown>) => void
  onEdited: () => void
  onStartAssignment: () => void
}) {
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null)
  const [showCounter, setShowCounter] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

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
          message={`Accept ${buyer ? `${buyer.name || 'this buyer'}'s` : 'this'} offer of ${formatCurrency(offer.offer_amount)}? This cannot be undone.`}
          confirmLabel="Accept Offer"
          confirmClass="bg-[var(--ck-success)] text-white hover:opacity-90"
          onConfirm={handleAccept}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reject' && (
        <ConfirmDialog
          title="Reject Offer?"
          message={`Reject ${buyer ? `${buyer.name || 'this buyer'}'s` : 'this'} offer of ${formatCurrency(offer.offer_amount)}?`}
          confirmLabel="Reject"
          confirmClass="bg-[#E32E2E] text-white hover:bg-[#c72626]"
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
      {showEdit && (
        <EditOfferModal
          offer={offer}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); onEdited() }}
          onDeleted={() => { setShowEdit(false); onEdited() }}
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
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-4">
              <p className="text-xs font-bold text-purple-300 mb-1">Counter Offer: {formatCurrency(offer.counter_amount)}</p>
              {offer.counter_notes && <p className="text-xs text-purple-400">{offer.counter_notes}</p>}
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
                <p className="text-sm font-semibold text-slate-900">{buyer.name || 'Buyer'}</p>
                {buyer.company && <p className="text-xs text-slate-500">{buyer.company}</p>}
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
                    className="p-2 rounded-lg hover:bg-[#E32E2E]/10 text-slate-400 hover:text-[#f87171] transition-colors"
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

          {/* Documents */}
          {offer.tc_file && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
              <p className="text-xs font-bold text-slate-500 mb-1">Transaction Coordination</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-700">
                  <Icon name="fact_check" size="text-sm" />
                  {offer.tc_file.status.replace(/_/g, ' ')}
                </span>
                {offer.tc_file.closing_scheduled_at && (
                  <span className="text-xs text-slate-500">Closing {formatDate(offer.tc_file.closing_scheduled_at)}</span>
                )}
                <Link href="/dispo/tc" className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-[#E32E2E] hover:underline">
                  Open TC File
                  <Icon name="arrow_forward" size="text-sm" />
                </Link>
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="mb-4">
            <DocumentManager
              entityType="offer"
              entityId={offer.id}
              side="dispositions"
              defaultDocType="proof_of_funds"
              title="Offer Documents"
              defaultCollapsed
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 bg-transparent border border-slate-300 text-slate-600 hover:bg-slate-100 hover:border-slate-400 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
            >
              <Icon name="edit" size="text-sm" />
              Edit
            </button>
            {offer.status === 'accepted' && !offer.assignment_sent_at && (
              <button
                onClick={onStartAssignment}
                className="flex items-center gap-1.5 bg-[#E32E2E] hover:bg-[#c72626] text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                <Icon name="description" size="text-sm" />
                Send Assignment
              </button>
            )}
            {offer.assignment_sent_at && !offer.assignment_signed_at && (
              <span className="inline-flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/40 text-amber-300 rounded-lg px-4 py-2 text-sm font-semibold">
                <Icon name="outgoing_mail" size="text-sm" />
                Awaiting buyer signature
              </span>
            )}
            {offer.assignment_signed_at && offer.assignment_document_url && (
              <a
                href={offer.assignment_document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-[var(--ck-success)] text-white hover:opacity-90 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity"
              >
                <Icon name="verified" size="text-sm" />
                View signed contract
              </a>
            )}
            {canAct && (
              <>
                <button
                  onClick={() => setConfirm('accept')}
                  className="flex items-center gap-1.5 bg-[var(--ck-success)] text-white hover:opacity-90 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity"
                >
                  <Icon name="check_circle" size="text-sm" />
                  Accept
                </button>
                <button
                  onClick={() => setShowCounter(true)}
                  className="flex items-center gap-1.5 bg-[var(--ck-warn)] text-[#0a0a0a] hover:opacity-90 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity"
                >
                  <Icon name="swap_horizontal_circle" size="text-sm" />
                  Counter
                </button>
                <button
                  onClick={() => setConfirm('reject')}
                  className="flex items-center gap-1.5 bg-[#E32E2E]/10 border border-[#E32E2E]/40 text-[var(--ck-accent-bright)] hover:bg-[#E32E2E]/20 hover:border-[#E32E2E]/60 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                >
                  <Icon name="cancel" size="text-sm" />
                  Reject
                </button>
              </>
            )}
          </div>
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
  const [newOfferOpen, setNewOfferOpen] = useState(false)
  const [assignmentOffer, setAssignmentOffer] = useState<BuyerOffer | null>(null)

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

  async function handleToggleTopPick(offer: BuyerOffer) {
    const next = !offer.is_top_pick
    // Optimistic local update — star flips instantly, server reconciles
    setOffers(prev => prev.map(o => {
      if (o.id === offer.id) return { ...o, is_top_pick: next }
      if (next && o.lead_id === offer.lead_id) return { ...o, is_top_pick: false }
      return o
    }))
    try {
      const res = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_top_pick: next }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update top pick')
      }
      setFeedback(next ? 'Marked as top pick' : 'Cleared top pick')
      setTimeout(() => setFeedback(null), 2000)
    } catch (err) {
      // Revert optimistic update on failure
      fetchOffers()
      setFeedback(err instanceof Error ? err.message : 'Failed to update top pick')
      setTimeout(() => setFeedback(null), 3000)
    }
  }

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
        <button
          onClick={() => setNewOfferOpen(true)}
          className="bg-[#E32E2E] hover:bg-[#c72626] text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
        >
          <Icon name="add" size="text-base" />
          New Offer
        </button>
      </div>

      {newOfferOpen && (
        <NewOfferModal
          onClose={() => setNewOfferOpen(false)}
          onCreated={() => { setFeedback('Offer created'); setTimeout(() => setFeedback(null), 2500); fetchOffers() }}
        />
      )}

      {assignmentOffer && (
        <AssignmentPreviewModal
          offer={assignmentOffer}
          onClose={() => setAssignmentOffer(null)}
          onSent={() => { setAssignmentOffer(null); setFeedback('Assignment sent'); setTimeout(() => setFeedback(null), 2500); fetchOffers() }}
        />
      )}

      {/* Status filters */}
      <div className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map(({ val, label }) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
              statusFilter === val
                ? 'bg-[#E32E2E] text-white'
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
                {groupOffersByProperty(filtered).map(group => {
                  const leadId = group.scored[0].offer.lead_id
                  const address = group.lead?.property_address ?? 'Unknown property'
                  const isCompetitive = group.scored.length > 1
                  return (
                    <Fragment key={leadId}>
                      <tr className="bg-slate-100 border-y border-slate-200">
                        <td colSpan={7} className="px-4 py-2">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
                            <Icon name="home" size="text-sm" className="text-slate-500" />
                            <span>{address}</span>
                            <span className="ml-1 text-slate-500 font-semibold normal-case tracking-normal">
                              · {group.scored.length} offer{group.scored.length !== 1 ? 's' : ''}
                              {group.askingPrice != null && (
                                <span className="ml-2 text-slate-400">· ask {formatCurrency(group.askingPrice)}</span>
                              )}
                              {group.isManualTop && (
                                <span className="ml-2 text-amber-600">· manual top pick</span>
                              )}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {group.scored.map(({ offer, score }) => {
                        const isTop = isCompetitive && offer.id === group.topId
                        const canToggle = isCompetitive
                        const tooltip = `Fit score ${score.total}/100\n` +
                          score.breakdown.map(b => `  ${b.label}: ${b.points} (${b.detail})`).join('\n')
                        return (
                          <Fragment key={offer.id}>
                            <tr
                              className={cn(
                                'group border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer',
                                expandedId === offer.id && 'bg-slate-50'
                              )}
                              onClick={() => setExpandedId(expandedId === offer.id ? null : offer.id)}
                            >
                              <td className="px-4 py-3 text-slate-700">
                                <span className="inline-flex items-center gap-1.5">
                                  <span>{offer.buyer ? (offer.buyer.name || '—') : '—'}</span>
                                  {canToggle && (
                                    <button
                                      type="button"
                                      title={isTop ? `Top pick — click to clear\n\n${tooltip}` : `Click to make this the top pick\n\n${tooltip}`}
                                      onClick={(e) => { e.stopPropagation(); handleToggleTopPick(offer) }}
                                      className={cn(
                                        'inline-flex items-center justify-center rounded hover:bg-amber-500/10 transition-colors',
                                        isTop ? 'text-amber-400' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-400'
                                      )}
                                    >
                                      <Icon name={isTop ? 'star' : 'star_border'} size="text-base" />
                                    </button>
                                  )}
                                  {!canToggle && isTop && (
                                    <Icon name="star" size="text-base" className="text-amber-400" />
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-bold text-slate-900">
                                {formatCurrency(offer.offer_amount)}
                                {offer.counter_amount != null && (
                                  <span className="ml-2 text-xs font-normal text-amber-500">
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
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize', statusBadge(offer.status))}>
                                    {offer.status}
                                  </span>
                                  {(() => {
                                    const ab = assignmentBadge(offer)
                                    if (!ab) return null
                                    const isActionable = !offer.assignment_sent_at
                                    const cls = cn(
                                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap',
                                      ab.className,
                                      isActionable && 'cursor-pointer hover:border-[#E32E2E]/70 hover:text-[var(--ck-accent-bright)] transition-colors'
                                    )
                                    return isActionable ? (
                                      <button
                                        type="button"
                                        onClick={e => { e.stopPropagation(); setAssignmentOffer(offer) }}
                                        className={cls}
                                        title="Start assignment wizard"
                                      >
                                        <Icon name={ab.icon} size="text-[13px]" />
                                        {ab.label}
                                      </button>
                                    ) : (
                                      <span className={cls}>
                                        <Icon name={ab.icon} size="text-[13px]" />
                                        {ab.label}
                                      </span>
                                    )
                                  })()}
                                  {(() => {
                                    const tb = tcBadge(offer)
                                    if (!tb) return null
                                    return (
                                      <Link
                                        href="/dispo/tc"
                                        onClick={(e) => e.stopPropagation()}
                                        className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap', tb.className)}
                                      >
                                        <Icon name="fact_check" size="text-[13px]" />
                                        {tb.label}
                                      </Link>
                                    )
                                  })()}
                                </div>
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
                              <tr className="border-b border-slate-100">
                                <td colSpan={7} className="p-0">
                                  <OfferDetail
                                    offer={offer}
                                    onAction={handleAction}
                                    onEdited={() => { setFeedback('Offer updated'); setTimeout(() => setFeedback(null), 2000); fetchOffers() }}
                                    onStartAssignment={() => setAssignmentOffer(offer)}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
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
