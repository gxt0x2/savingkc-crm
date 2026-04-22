'use client'

import { useState } from 'react'

interface OfferFormProps {
  slug: string
  askingPrice?: number | null
}

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
        className="w-full bg-teal-600 text-white hover:bg-teal-700 rounded-lg px-4 py-3 text-sm font-bold transition-colors"
      >
        Make an Offer
      </button>
    )
  }

  return (
    <>
      {/* Modal backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">Make an Offer</h2>
            <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {submitted ? (
            <div className="px-6 py-12 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Offer Submitted!</h3>
              <p className="text-gray-500 text-sm">We&apos;ll review your offer and get back to you shortly.</p>
              <button
                onClick={() => setOpen(false)}
                className="mt-6 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg px-6 py-2 text-sm font-semibold"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
              )}

              {askingPrice && (
                <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                  Asking Price: <span className="font-bold text-gray-900">${askingPrice.toLocaleString()}</span>
                </div>
              )}

              {/* Offer Details */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Offer Amount *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input
                      type="number"
                      required
                      min={1}
                      value={form.offer_amount}
                      onChange={e => set('offer_amount', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                      placeholder="150,000"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Earnest Money</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input
                      type="number"
                      min={0}
                      value={form.earnest_money}
                      onChange={e => set('earnest_money', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                      placeholder="5,000"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Close Days</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={form.close_days}
                    onChange={e => set('close_days', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Inspection Days</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={form.inspection_days}
                    onChange={e => set('inspection_days', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Financing Type</label>
                  <select
                    value={form.financing_type}
                    onChange={e => set('financing_type', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  >
                    <option value="cash">Cash</option>
                    <option value="hard_money">Hard Money</option>
                    <option value="private_money">Private Money</option>
                    <option value="conventional">Conventional</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Contingencies</label>
                <textarea
                  rows={2}
                  value={form.contingencies}
                  onChange={e => set('contingencies', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-none"
                  placeholder="Any contingencies..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-none"
                  placeholder="Anything else we should know..."
                />
              </div>

              {/* Buyer Info */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-600 mb-3">Your Information</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={form.buyer_name}
                      onChange={e => set('buyer_name', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                      placeholder="John Smith"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Phone *</label>
                      <input
                        type="tel"
                        required
                        value={form.buyer_phone}
                        onChange={e => set('buyer_phone', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        placeholder="(816) 555-1234"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Email *</label>
                      <input
                        type="email"
                        required
                        value={form.buyer_email}
                        onChange={e => set('buyer_email', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        placeholder="john@example.com"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2 pb-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-teal-600 text-white hover:bg-teal-700 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-60 transition-colors"
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
        className="w-full bg-teal-600 text-white hover:bg-teal-700 rounded-lg px-4 py-3 text-sm font-bold transition-colors"
      >
        Make an Offer
      </button>
    </>
  )
}
