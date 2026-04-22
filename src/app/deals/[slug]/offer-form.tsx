'use client'

import { useState } from 'react'

interface OfferFormProps {
  slug: string
  askingPrice?: number | null
}

const input = 'w-full border border-[#e0e0e0] rounded-xl px-3.5 py-2.5 text-[14px] text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 transition-colors placeholder:text-[#ccc]'

export default function OfferForm({ slug, askingPrice }: OfferFormProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    offer_amount: '',
    earnest_money: '',
    close_days: '14',
    inspection_days: '10',
    financing_type: 'cash',
    contingencies: '',
    notes: '',
    buyer_name: '',
    buyer_phone: '',
    buyer_email: '',
  })

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch(`/api/deals/${slug}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_amount: Number(form.offer_amount),
          earnest_money: form.earnest_money ? Number(form.earnest_money) : undefined,
          close_days: form.close_days ? Number(form.close_days) : undefined,
          inspection_days: form.inspection_days ? Number(form.inspection_days) : undefined,
          financing_type: form.financing_type || undefined,
          contingencies: form.contingencies || undefined,
          notes: form.notes || undefined,
          buyer_name: form.buyer_name,
          buyer_phone: form.buyer_phone,
          buyer_email: form.buyer_email,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit offer')
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit offer')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full bg-[#1a1a1a] text-white hover:bg-[#333] rounded-xl px-4 py-3 text-[14px] font-semibold transition-colors"
      >
        Make offer
      </button>
    )
  }

  return (
    <>
      {/* Modal backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#eaeaea]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0f0f0]">
            <h2 className="text-[17px] font-semibold text-[#1a1a1a]">Make an Offer</h2>
            <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-[#f5f5f5] rounded-lg text-[#999] transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {submitted ? (
            <div className="px-6 py-14 text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-[20px] font-semibold text-[#1a1a1a] mb-2">Offer Submitted!</h3>
              <p className="text-[14px] text-[#888]">We&apos;ll review your offer and get back to you shortly.</p>
              <button
                onClick={() => setOpen(false)}
                className="mt-8 bg-[#f5f5f5] text-[#444] hover:bg-[#eee] rounded-xl px-6 py-2.5 text-[14px] font-medium transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] rounded-xl px-4 py-3">{error}</div>
              )}

              {askingPrice && (
                <div className="bg-[#fafafa] rounded-xl px-4 py-3 text-[14px] text-[#666] border border-[#f0f0f0]">
                  Asking Price: <span className="font-semibold text-[#1a1a1a]">${askingPrice.toLocaleString()}</span>
                </div>
              )}

              {/* Offer Details */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Offer Amount *</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#bbb] text-[14px]">$</span>
                    <input
                      type="number"
                      required
                      min={1}
                      value={form.offer_amount}
                      onChange={e => set('offer_amount', e.target.value)}
                      className={`${input} pl-7`}
                      placeholder="150,000"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Earnest Money</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#bbb] text-[14px]">$</span>
                    <input
                      type="number"
                      min={0}
                      value={form.earnest_money}
                      onChange={e => set('earnest_money', e.target.value)}
                      className={`${input} pl-7`}
                      placeholder="5,000"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Close Days</label>
                  <input type="number" min={1} max={365} value={form.close_days} onChange={e => set('close_days', e.target.value)} className={input} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Inspection Days</label>
                  <input type="number" min={0} max={90} value={form.inspection_days} onChange={e => set('inspection_days', e.target.value)} className={input} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Financing Type</label>
                  <select value={form.financing_type} onChange={e => set('financing_type', e.target.value)} className={input}>
                    <option value="cash">Cash</option>
                    <option value="hard_money">Hard Money</option>
                    <option value="private_money">Private Money</option>
                    <option value="conventional">Conventional</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#666] mb-1.5">Contingencies</label>
                <textarea rows={2} value={form.contingencies} onChange={e => set('contingencies', e.target.value)} className={`${input} resize-none`} placeholder="Any contingencies..." />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#666] mb-1.5">Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} className={`${input} resize-none`} placeholder="Anything else we should know..." />
              </div>

              {/* Buyer Info */}
              <div className="border-t border-[#f0f0f0] pt-5">
                <p className="text-[13px] font-semibold text-[#888] uppercase tracking-wider mb-4">Your Information</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#666] mb-1.5">Full Name *</label>
                    <input type="text" required value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} className={input} placeholder="John Smith" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13px] font-medium text-[#666] mb-1.5">Phone *</label>
                      <input type="tel" required value={form.buyer_phone} onChange={e => set('buyer_phone', e.target.value)} className={input} placeholder="(816) 555-1234" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#666] mb-1.5">Email *</label>
                      <input type="email" required value={form.buyer_email} onChange={e => set('buyer_email', e.target.value)} className={input} placeholder="john@example.com" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-3 pb-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 border border-[#ddd] text-[#444] hover:bg-[#fafafa] rounded-xl px-4 py-2.5 text-[14px] font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-[#1a1a1a] text-white hover:bg-[#333] rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Submitting...' : 'Submit Offer'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* The trigger button (still visible behind modal) */}
      <button
        onClick={() => setOpen(true)}
        className="w-full bg-[#1a1a1a] text-white hover:bg-[#333] rounded-xl px-4 py-3 text-[14px] font-semibold transition-colors"
      >
        Make offer
      </button>
    </>
  )
}
