'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { trackEvent } from './track-events'
import { dispatchConversion } from './tracker'

interface OfferFormProps {
  slug: string
  askingPrice?: number | null
  earnestMoney?: number | null
  photo?: string
  propertyAddress?: string
  location?: string
  triggerClassName?: string
  triggerLabel?: string
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function CloseIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

const input = 'w-full border border-[#e0e0e0] rounded-2xl px-3.5 py-2.5 text-[14px] text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-colors placeholder:text-[#ccc]'
const defaultTriggerClassName = 'w-full bg-[#ef4444] text-white hover:bg-[#dc2626] rounded-2xl px-4 py-3 text-[14px] font-semibold transition-colors'
const EMD_DEFAULT_AMOUNT = 5000

export default function OfferForm({
  slug,
  askingPrice,
  earnestMoney,
  photo,
  propertyAddress,
  location,
  triggerClassName,
  triggerLabel = 'Make offer',
}: OfferFormProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [mounted, setMounted] = useState(false)
  const modalDragRef = useRef<{ startY: number; offset: number } | null>(null)
  const lockedEmdAmount = earnestMoney ?? EMD_DEFAULT_AMOUNT

  const [form, setForm] = useState({
    financing_type: 'cash',
    offer_amount: '',
    earnest_money: String(lockedEmdAmount),
    buyer_name: '',
    buyer_company: '',
    buyer_phone: '',
    buyer_email: '',
    notes: '',
  })

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    setMounted(true)
  }, [])

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
          buyer_company: form.buyer_company,
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

  const closeModal = useCallback(() => {
    modalDragRef.current = null
    setDragOffset(0)
    setOpen(false)
  }, [])

  const beginModalDrag = useCallback((clientY: number) => {
    modalDragRef.current = { startY: clientY, offset: 0 }
  }, [])

  const updateModalDrag = useCallback((clientY: number) => {
    if (!modalDragRef.current) return
    const offset = Math.max(0, clientY - modalDragRef.current.startY)
    modalDragRef.current.offset = offset
    setDragOffset(offset)
  }, [])

  const finishModalDrag = useCallback(() => {
    if (!modalDragRef.current) return
    if (modalDragRef.current.offset > 80) {
      closeModal()
      return
    }
    modalDragRef.current = null
    setDragOffset(0)
  }, [closeModal])

  const handleModalPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    beginModalDrag(event.clientY)
  }, [beginModalDrag])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!modalDragRef.current) return
      event.preventDefault()
      updateModalDrag(event.clientY)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!modalDragRef.current) return
      event.preventDefault()
      updateModalDrag(event.clientY)
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (!modalDragRef.current || event.touches.length === 0) return
      event.preventDefault()
      updateModalDrag(event.touches[0].clientY)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', finishModalDrag)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishModalDrag)
    window.addEventListener('pointercancel', finishModalDrag)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', finishModalDrag)
    window.addEventListener('touchcancel', finishModalDrag)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', finishModalDrag)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishModalDrag)
      window.removeEventListener('pointercancel', finishModalDrag)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', finishModalDrag)
      window.removeEventListener('touchcancel', finishModalDrag)
    }
  }, [finishModalDrag, updateModalDrag])

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          trackEvent(slug, 'offer_modal_open', {
            section: 'pricing_sidebar',
            cta_id: 'deal_make_offer',
            cta_label: triggerLabel,
            destination: 'offer_modal',
            asking_price_visible: Boolean(askingPrice),
            arv_visible: Boolean(arv),
          })
        }}
        className={triggerClassName ?? defaultTriggerClassName}
      >
        {triggerLabel}
      </button>
    )
  }

  const modal = (
    <>
      <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/45 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+8px)] backdrop-blur-sm sm:items-center sm:p-4" onClick={closeModal}>
        <button
          type="button"
          onClick={closeModal}
          className="fixed right-4 top-[calc(env(safe-area-inset-top)+14px)] z-[120] flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/95 text-[#1a1a1a] shadow-[0_8px_24px_rgba(0,0,0,0.22)] backdrop-blur transition-transform active:scale-95 sm:hidden"
          aria-label="Close offer form"
        >
          <CloseIcon className="h-6 w-6" />
        </button>
        <div
          data-testid="offer-modal-scroll"
          data-track-scroll-container
          className="max-h-[calc(100dvh-env(safe-area-inset-top)-18px)] w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[#eaeaea] bg-white shadow-2xl transition-transform sm:max-h-[90vh] sm:max-w-md"
          style={{
            WebkitOverflowScrolling: 'touch',
            transform: `translateY(${dragOffset}px)`,
          }}
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
                onClick={closeModal}
                className="mt-8 bg-[#f5f5f5] text-[#444] hover:bg-[#eee] rounded-2xl px-6 py-2.5 text-[14px] font-medium transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="sticky top-0 z-10 bg-white/95 px-5 pt-2 backdrop-blur">
                <button
                  type="button"
                  aria-label="Pull down to close offer form"
                  onPointerDown={handleModalPointerDown}
                  onPointerMove={(event) => updateModalDrag(event.clientY)}
                  onPointerUp={finishModalDrag}
                  onPointerCancel={finishModalDrag}
                  onTouchStart={(event) => {
                    if (event.touches.length > 0) beginModalDrag(event.touches[0].clientY)
                  }}
                  onTouchMove={(event) => {
                    if (event.touches.length > 0) updateModalDrag(event.touches[0].clientY)
                  }}
                  onTouchEnd={finishModalDrag}
                  className="mx-auto flex h-7 w-28 touch-none items-center justify-center rounded-full"
                >
                  <span className="h-1.5 w-16 rounded-full bg-[#d1d1d6]" />
                </button>
              </div>

              {/* Property header with photo */}
              <div className="flex items-center gap-3.5 border-b border-[#f0f0f0] px-5 pb-4 pt-2">
                {photo && (
                  <img src={photo} alt="" className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[15px] font-semibold text-[#1a1a1a] truncate">{propertyAddress || 'Property'}</p>
                    <button type="button" onClick={closeModal} className="p-1 hover:bg-[#f5f5f5] rounded-xl text-[#999] transition-colors flex-shrink-0">
                      <CloseIcon />
                    </button>
                  </div>
                  {location && <p className="text-[13px] text-[#888] mt-0.5">{location}</p>}
                  <div className="flex items-center gap-3 mt-1">
                    {askingPrice && <span className="text-[14px] font-bold text-[#1a1a1a]">{fmt(askingPrice)}</span>}
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
                  <div className="flex overflow-hidden rounded-2xl border border-[#e0e0e0]">
                    {([
                      ['cash', 'Cash'],
                      ['hard_money', 'Hard Money'],
                    ] as const).map(([val, label], i) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => set('financing_type', val)}
                        className={`flex-1 py-2.5 text-[13px] font-medium transition-colors ${i > 0 ? 'border-l border-[#e0e0e0]' : ''} ${
                          form.financing_type === val
                            ? 'bg-[#ef4444] text-white'
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
                      name="offer_amount"
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
                      name="earnest_money"
                      required
                      min={lockedEmdAmount}
                      value={form.earnest_money}
                      readOnly
                      aria-readonly="true"
                      className={`${input} pl-7 bg-[#f8fafc] text-[#4b5563]`}
                      placeholder="5,000"
                    />
                  </div>
                  <p className="text-[12px] text-[#999] mt-1">{fmt(lockedEmdAmount)} locked by deal terms</p>
                </div>

                {/* Buyer identity */}
                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Your Name *</label>
                  <input
                    type="text"
                    name="buyer_name"
                    required
                    value={form.buyer_name}
                    onChange={e => set('buyer_name', e.target.value)}
                    className={input}
                    placeholder="Full name"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#666] mb-1.5">Buying Company *</label>
                  <input
                    type="text"
                    name="buyer_company"
                    required
                    value={form.buyer_company}
                    onChange={e => set('buyer_company', e.target.value)}
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
                      name="buyer_phone"
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
                      name="buyer_email"
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
                    name="notes"
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
                  className="w-full rounded-2xl bg-[#ef4444] px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#dc2626] disabled:opacity-50"
                >
                  {submitting ? 'Sending...' : 'Send offer'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

    </>
  )

  return mounted ? createPortal(modal, document.body) : null
}
