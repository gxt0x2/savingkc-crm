'use client'

import { useState } from 'react'
import { trackEvent } from './track-events'
import { dispatchConversion } from './tracker'

interface OfferFormProps {
  slug: string
  askingPrice?: number | null
  arv?: number | null
  photo?: string
  propertyAddress?: string
  location?: string
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

const input = 'w-full border border-[#e0e0e0] rounded-xl px-3.5 py-2.5 text-[14px] text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-colors placeholder:text-[#ccc]'

export default function OfferForm({ slug, askingPrice, arv, photo, propertyAddress, location }: OfferFormProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    financing_type: 'cash',
    offer_amount: '',
    earnest_money: '',
    buyer_name: '',
    buyer_phone: '',
    buyer_email: '',
    notes: '',
  })

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    trackEvent(slug, 'offer_submit_started', {
      section: 'offer_form',
      form_id: 'offer_form',
      has_offer_amount: Boolean(form.offer_amount),
      has_earnest_money: Boolean(form.earnest_money),
      financing: form.financing_type,
    })

    try {
      const res = await fetch(`/api/deals/${slug}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_amount: Number(form.offer_amount),
          earnest_money: form.earnest_money ? Number(form.earnest_money) : undefined,
          financing_type: form.financing_type || undefined,
          notes: form.notes || undefined,
          buyer_name: form.buyer_name,
          buyer_phone: form.buyer_phone,
          buyer_email: form.buyer_email,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit offer')
      }

      dispatchConversion('offer_submit', {
        section: 'offer_form',
        form_id: 'offer_form',
        offer_id: data.offer_id,
        amount: Number(form.offer_amount),
        financing: form.financing_type,
      })
      setSubmitted(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit offer'
      trackEvent(slug, 'offer_submit_error', {
        section: 'offer_form',
        form_id: 'offer_form',
        error_type: message === 'Validation failed' ? 'validation' : 'submit_failed',
        financing: form.financing_type,
      })
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          trackEvent(slug, 'offer_modal_open', {
            section: 'pricing_sidebar',
            cta_id: 'deal_make_offer',
            cta_label: 'Make offer',
            destination: 'offer_modal',
            asking_price_visible: Boolean(askingPrice),
            arv_visible: Boolean(arv),
          })
        }}
        className="w-full bg-[#E32E2E] text-white hover:bg-[#c72626] rounded-xl px-4 py-3 text-[14px] font-semibold transition-colors"
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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-[#eaeaea]"
          onClick={e => e.stopPropagation()}
        >
          {submitted ? (
            <div className="px-6 py-14 text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-[20px] font-semibold text-[#1a1a1a] mb-2">Offer Sent!</h3>
              <p className="text-[14px] text-[#888]">We&apos;ll review your offer and get back to you shortly.</p>
              <button
                onClick={() => setOpen(false)}
                className="mt-8 bg-[#f5f5f5] text-[#444] hover:bg-[#eee] rounded-xl px-6 py-2.5 text-[14px] font-medium transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Property header with photo */}
              <div className="flex items-center gap-3.5 px-5 py-4 border-b border-[#f0f0f0]">
                {photo && (
                  <img src={photo} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[15px] font-semibold text-[#1a1a1a] truncate">{propertyAddress || 'Property'}</p>
                    <button type="button" onClick={() => setOpen(false)} className="p-1 hover:bg-[#f5f5f5] rounded-lg text-[#999] transition-colors flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {location && <p className="text-[13px] text-[#888] mt-0.5">{location}</p>}
                  <div className="flex items-center gap-3 mt-1">
                    {askingPrice && <span className="text-[14px] font-bold text-[#1a1a1a]">{fmt(askingPrice)}</span>}
                    {arv && <span className="text-[12px] text-[#999]">ARV: {fmt(arv)}</span>}
                  </div>
                </div>
              </div>

              <div className="px-5 py-5 space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] rounded-xl px-4 py-3">{error}</div>
                )}

                {/* Financing type toggle */}
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-2">Financing Type</label>
                  <div className="flex rounded-xl border border-[#e0e0e0] overflow-hidden">
                    {([
                      ['cash', 'Cash'],
                      ['hard_money', 'Hard Money'],
                      ['conventional', 'Conventional'],
                    ] as const).map(([val, label], i) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => set('financing_type', val)}
                        className={`flex-1 py-2.5 text-[13px] font-medium transition-colors ${i > 0 ? 'border-l border-[#e0e0e0]' : ''} ${
                          form.financing_type === val
                            ? 'bg-[#E32E2E] text-white'
                            : 'bg-white text-[#666] hover:bg-[#fafafa]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Offer Amount */}
                <div>
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
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* EMD Amount */}
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">EMD Amount *</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#bbb] text-[14px]">$</span>
                    <input
                      type="number"
                      required
                      min={5000}
                      value={form.earnest_money}
                      onChange={e => set('earnest_money', e.target.value)}
                      className={`${input} pl-7`}
                      placeholder="5,000"
                    />
                  </div>
                  <p className="text-[12px] text-[#999] mt-1">$5,000 minimum</p>
                </div>

                {/* Buying Company Name */}
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Buying Company Name *</label>
                  <input
                    type="text"
                    required
                    value={form.buyer_name}
                    onChange={e => set('buyer_name', e.target.value)}
                    className={input}
                    placeholder="Company name"
                  />
                </div>

                {/* Phone + Email row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#666] mb-1.5">Phone *</label>
                    <input
                      type="tel"
                      required
                      value={form.buyer_phone}
                      onChange={e => set('buyer_phone', e.target.value)}
                      className={input}
                      placeholder="(555) 555-5555"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[#666] mb-1.5">Email *</label>
                    <input
                      type="email"
                      required
                      value={form.buyer_email}
                      onChange={e => set('buyer_email', e.target.value)}
                      className={input}
                      placeholder="you@company.com"
                    />
                  </div>
                </div>

                {/* Add comment */}
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Add comment</label>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    className={`${input} resize-none`}
                    placeholder="Any additional details..."
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="px-5 pb-5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-[#E32E2E] text-white hover:bg-[#c72626] rounded-xl px-4 py-3 text-[14px] font-semibold disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Sending...' : 'Send offer'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* The trigger button */}
      <button
        onClick={() => { setOpen(true); trackEvent(slug, 'offer_modal_open') }}
        className="w-full bg-[#E32E2E] text-white hover:bg-[#c72626] rounded-xl px-4 py-3 text-[14px] font-semibold transition-colors"
      >
        Make offer
      </button>
    </>
  )
}
