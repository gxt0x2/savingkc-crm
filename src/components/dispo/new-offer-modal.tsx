'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'

interface LeadOption {
  id: string
  full_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
}

interface BuyerOption {
  id: string
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
}

interface Props {
  onClose: () => void
  onCreated: () => void
}

export function NewOfferModal({ onClose, onCreated }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lead search
  const [leadQuery, setLeadQuery] = useState('')
  const [leadResults, setLeadResults] = useState<LeadOption[]>([])
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null)

  // Buyer search
  const [buyerQuery, setBuyerQuery] = useState('')
  const [buyerResults, setBuyerResults] = useState<BuyerOption[]>([])
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerOption | null>(null)
  const [newBuyerMode, setNewBuyerMode] = useState(false)

  // Offer fields
  const [form, setForm] = useState({
    offer_amount: '',
    earnest_money: '',
    financing_type: 'cash',
    close_days: '30',
    inspection_days: '10',
    notes: '',
    status: 'pending',
    buyer_name: '',
    buyer_phone: '',
    buyer_email: '',
    buyer_company: '',
  })

  const leadDebounceRef = useRef<number | null>(null)
  const buyerDebounceRef = useRef<number | null>(null)

  // Lead search
  useEffect(() => {
    if (selectedLead) return
    if (leadDebounceRef.current) window.clearTimeout(leadDebounceRef.current)
    if (leadQuery.length < 2) { setLeadResults([]); return }
    leadDebounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(leadQuery)}&limit=10`)
        const data = await res.json()
        setLeadResults(data.leads || data.results || [])
      } catch { /* ignore */ }
    }, 250)
  }, [leadQuery, selectedLead])

  // Buyer search
  useEffect(() => {
    if (selectedBuyer || newBuyerMode) return
    if (buyerDebounceRef.current) window.clearTimeout(buyerDebounceRef.current)
    if (buyerQuery.length < 2) { setBuyerResults([]); return }
    buyerDebounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/buyers?search=${encodeURIComponent(buyerQuery)}&limit=10`)
        const data = await res.json()
        setBuyerResults(data.buyers || [])
      } catch { /* ignore */ }
    }, 250)
  }, [buyerQuery, selectedBuyer, newBuyerMode])

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedLead) { setError('Please select a lead'); return }
    if (!selectedBuyer && !newBuyerMode) { setError('Please select or create a buyer'); return }
    if (newBuyerMode && !form.buyer_name) { setError('Buyer name required'); return }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        lead_id: selectedLead.id,
        offer_amount: Number(form.offer_amount),
        earnest_money: form.earnest_money ? Number(form.earnest_money) : undefined,
        financing_type: form.financing_type,
        close_days: form.close_days ? Number(form.close_days) : undefined,
        inspection_days: form.inspection_days ? Number(form.inspection_days) : undefined,
        notes: form.notes || undefined,
        status: form.status,
      }
      if (selectedBuyer) {
        body.buyer_id = selectedBuyer.id
      } else {
        body.buyer_name = form.buyer_name
        body.buyer_phone = form.buyer_phone || undefined
        body.buyer_email = form.buyer_email || undefined
        body.buyer_company = form.buyer_company || undefined
      }

      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create offer')
      }
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create offer')
    } finally {
      setSubmitting(false)
    }
  }

  const input = 'w-full border border-[var(--crm-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-[var(--crm-danger-border)] transition-colors bg-[var(--crm-surface)]'
  const label = 'block text-[11px] font-semibold text-[var(--crm-text)] uppercase tracking-wider mb-1'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--crm-surface)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--crm-border)]">
          <h2 className="text-lg font-bold text-[var(--crm-ink)]">New Offer</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-[var(--crm-surface-subtle)] rounded-lg text-[var(--crm-text-muted)]">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="bg-[var(--crm-danger-soft)] border border-[var(--crm-danger-border)] text-[var(--crm-danger)] text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Lead selector */}
          <div>
            <label className={label}>Lead / Property *</label>
            {selectedLead ? (
              <div className="flex items-center justify-between bg-[var(--crm-surface-subtle)] border border-[var(--crm-border)] rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--crm-ink)]">{selectedLead.property_address || selectedLead.full_name}</p>
                  <p className="text-xs text-[var(--crm-text-muted)]">{[selectedLead.city, selectedLead.state].filter(Boolean).join(', ')} · {selectedLead.full_name}</p>
                </div>
                <button type="button" onClick={() => { setSelectedLead(null); setLeadQuery('') }} className="text-xs text-[var(--crm-danger)] font-semibold">Change</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={leadQuery}
                  onChange={e => setLeadQuery(e.target.value)}
                  placeholder="Search by address, name, or phone…"
                  className={input}
                />
                {leadResults.length > 0 && (
                  <div className="mt-1 border border-[var(--crm-border)] rounded-lg divide-y divide-[var(--crm-border)] max-h-48 overflow-y-auto">
                    {leadResults.map(l => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => { setSelectedLead(l); setLeadResults([]); setLeadQuery('') }}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--crm-surface-subtle)]"
                      >
                        <p className="text-sm font-semibold text-[var(--crm-ink)]">{l.property_address || l.full_name}</p>
                        <p className="text-xs text-[var(--crm-text-muted)]">{[l.city, l.state].filter(Boolean).join(', ')} · {l.full_name}</p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Buyer selector */}
          <div>
            <label className={label}>Buyer *</label>
            {selectedBuyer ? (
              <div className="flex items-center justify-between bg-[var(--crm-surface-subtle)] border border-[var(--crm-border)] rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--crm-ink)]">
                    {selectedBuyer.name || selectedBuyer.company || 'Buyer'}
                  </p>
                  <p className="text-xs text-[var(--crm-text-muted)]">{selectedBuyer.email || selectedBuyer.phone}</p>
                </div>
                <button type="button" onClick={() => { setSelectedBuyer(null); setBuyerQuery('') }} className="text-xs text-[var(--crm-danger)] font-semibold">Change</button>
              </div>
            ) : newBuyerMode ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[var(--crm-text)]">New buyer details</span>
                  <button type="button" onClick={() => setNewBuyerMode(false)} className="text-xs text-[var(--crm-brand)] font-semibold">Search existing instead</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={input} placeholder="Name *" value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} />
                  <input className={input} placeholder="Company" value={form.buyer_company} onChange={e => set('buyer_company', e.target.value)} />
                  <input className={input} placeholder="Phone" value={form.buyer_phone} onChange={e => set('buyer_phone', e.target.value)} />
                  <input className={input} placeholder="Email" value={form.buyer_email} onChange={e => set('buyer_email', e.target.value)} />
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={buyerQuery}
                    onChange={e => setBuyerQuery(e.target.value)}
                    placeholder="Search buyers by name, phone, email…"
                    className={input}
                  />
                  <button type="button" onClick={() => setNewBuyerMode(true)} className="bg-[var(--crm-surface-subtle)] hover:bg-[var(--crm-surface-subtle)] text-[var(--crm-text)] text-xs font-semibold px-3 rounded-lg whitespace-nowrap">
                    + New
                  </button>
                </div>
                {buyerResults.length > 0 && (
                  <div className="mt-1 border border-[var(--crm-border)] rounded-lg divide-y divide-[var(--crm-border)] max-h-48 overflow-y-auto">
                    {buyerResults.map(b => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { setSelectedBuyer(b); setBuyerResults([]); setBuyerQuery('') }}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--crm-surface-subtle)]"
                      >
                        <p className="text-sm font-semibold text-[var(--crm-ink)]">
                          {b.name || b.company || 'Buyer'}
                        </p>
                        <p className="text-xs text-[var(--crm-text-muted)]">{b.email || b.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Offer terms */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Offer Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-dim)] text-sm">$</span>
                <input
                  type="number"
                  required
                  min={1}
                  className={`${input} pl-6`}
                  value={form.offer_amount}
                  onChange={e => set('offer_amount', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className={label}>Earnest Money</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-dim)] text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  className={`${input} pl-6`}
                  value={form.earnest_money}
                  onChange={e => set('earnest_money', e.target.value)}
                  placeholder="5,000"
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
              <select className={input} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="reviewing">Reviewing</option>
                <option value="countered">Countered</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <label className={label}>Close Days</label>
              <input type="number" min={1} className={input} value={form.close_days} onChange={e => set('close_days', e.target.value)} placeholder="30" />
            </div>
            <div>
              <label className={label}>Inspection Days</label>
              <input type="number" min={0} className={input} value={form.inspection_days} onChange={e => set('inspection_days', e.target.value)} placeholder="10" />
            </div>
          </div>

          <div>
            <label className={label}>Notes</label>
            <textarea
              rows={3}
              className={`${input} resize-none`}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any additional details…"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[var(--crm-text)] hover:text-[var(--crm-ink)] px-4 py-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="bg-[var(--crm-brand)] hover:bg-[var(--crm-brand-hover)] text-[var(--crm-on-brand)] text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving…' : 'Create Offer'}
          </button>
        </div>
      </form>
    </div>
  )
}
