'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent as ReactUIEvent } from 'react'
import OfferForm from './offer-form'
import ShareButton from './share-button'

type Lead = {
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  property_type: string | null
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  arv: number | null
  offer_amount: number | null
  asking_price?: number | null
  lot_size: number | null
  year_built: number | null
}

type DealPageRecord = {
  title: string | null
  description: string | null
  show_address: boolean | null
  show_arv: boolean | null
  show_asking_price: boolean | null
  show_assignment_fee: boolean | null
  accept_offers: boolean | null
  created_at: string
  contract_close_date: string | null
  earnest_money: number | null
  inspection_period_days: number | null
  financing_terms: string | null
  repair_estimate_low: number | null
  repair_estimate_high: number | null
  property_condition: string | null
  parking: string | null
  contract_notes: string | null
  assignment_fee: number | null
}

type InspectionReport = {
  name: string
  url: string
  uploaded_at: string
}

type MobileDealPageProps = {
  slug: string
  title: string
  dealPage: DealPageRecord
  lead: Lead | null
  photos: string[]
  videos: string[]
  inspectionReports: InspectionReport[]
  askingPrice: number | null
  arv: number | null
}

const ACCENT_RED = '#ef4444'
const SALE_BLUE = '#2563eb'
const SHEET_COLLAPSED = 38
const SHEET_SCROLL_LIFT = 50
const SHEET_MID = 56
const SHEET_EXPANDED = 76
const SHEET_SNAPS = [SHEET_COLLAPSED, SHEET_MID, SHEET_EXPANDED]
const INITIAL_PHOTO_RENDER_COUNT = 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '-'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString('en-US')
}

function fmtDate(dateValue: string): string {
  const [year, month, day] = dateValue.split('T')[0].split('-').map(Number)
  if (year && month && day) {
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function bathText(full: number | null | undefined, half: number | null | undefined): string | null {
  if (full == null && !half) return null
  const total = (full ?? 0) + (half ? 0.5 : 0)
  const formatted = total % 1 === 0 ? String(total) : total.toFixed(1)
  return `${formatted} Bath${total === 1 ? '' : 's'}`
}

function addressLine(lead: Lead | null, showAddress: boolean): string {
  if (!lead) return 'Kansas City area'
  if (showAddress && lead.property_address) {
    const cityState = [lead.city, lead.state].filter(Boolean).join(', ')
    return `${lead.property_address}${cityState ? `, ${cityState}` : ''}${lead.zip ? ` ${lead.zip}` : ''}`
  }
  return `${[lead.county, lead.city, lead.state].filter(Boolean).join(', ')}${lead.zip ? ` ${lead.zip}` : ''}` || 'Kansas City area'
}

function displayDescription(description: string | null): string {
  if (!description) return 'No description provided.'
  const cleaned = description
    .split(/\r?\n/)
    .filter((line) => !/gross\s*margin/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned || 'No description provided.'
}

function IconHeart({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.9 0-3.535 1.08-4.312 2.633C11.223 4.83 9.588 3.75 7.688 3.75 5.099 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" /></svg>
}

function IconShare({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" /></svg>
}

function IconPin({ className = '' }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.25A7.25 7.25 0 0 0 4.75 9.5c0 5.14 6.36 11.75 6.63 12.03a.87.87 0 0 0 1.24 0c.27-.28 6.63-6.89 6.63-12.03A7.25 7.25 0 0 0 12 2.25Zm0 10.12a2.87 2.87 0 1 1 0-5.74 2.87 2.87 0 0 1 0 5.74Z" /></svg>
}

function IconBed({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 19V9.75M3 16h18M5.25 12.75h5.25V10.5A1.5 1.5 0 0 0 9 9H5.25v3.75Zm5.25 0h8.25A2.25 2.25 0 0 1 21 15v4" /></svg>
}

function IconBath({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M5 12v4a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-4M7 20l-1 2m11-2 1 2M7 8V6.75A2.75 2.75 0 0 1 9.75 4h.5A2.75 2.75 0 0 1 13 6.75V8" /></svg>
}

function IconHome({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m3 10.75 9-7.5 9 7.5M5 9.5V20h5.25v-5.5h3.5V20H19V9.5" /></svg>
}

function IconChevron({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" /></svg>
}

function IconCloseSmall({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.1}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
}

function Metric({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-[15px] font-semibold text-[#0a0a0b]">
      <span className="text-[#36363d]">{icon}</span>
      {value}
    </div>
  )
}

export default function MobileDealPage({
  slug,
  title,
  dealPage,
  lead,
  photos,
  videos,
  inspectionReports,
  askingPrice,
  arv,
}: MobileDealPageProps) {
  const showAddress = dealPage.show_address !== false
  const location = addressLine(lead, showAddress)
  const bathValue = bathText(lead?.baths_full, lead?.baths_half)
  const repairEstimate = dealPage.repair_estimate_low != null && dealPage.repair_estimate_high != null
    ? `${fmt(dealPage.repair_estimate_low)} - ${fmt(dealPage.repair_estimate_high)}`
    : fmt(dealPage.repair_estimate_low ?? dealPage.repair_estimate_high)
  const hasTerms = dealPage.contract_close_date || dealPage.earnest_money != null || dealPage.inspection_period_days != null || dealPage.financing_terms
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [sheetHeight, setSheetHeight] = useState(SHEET_COLLAPSED)
  const [renderedPhotoCount, setRenderedPhotoCount] = useState(() => Math.min(INITIAL_PHOTO_RENDER_COUNT, photos.length))
  const [priorityPhotoLoadCount, setPriorityPhotoLoadCount] = useState(0)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const currentSheetHeightRef = useRef(SHEET_COLLAPSED)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const pendingSheetHeightRef = useRef<number | null>(null)
  const loadedPriorityPhotoIndexesRef = useRef<Set<number>>(new Set())
  const overviewText = displayDescription(dealPage.description)

  useEffect(() => {
    if (photos.length <= INITIAL_PHOTO_RENDER_COUNT || renderedPhotoCount >= photos.length) return

    const priorityTarget = Math.min(INITIAL_PHOTO_RENDER_COUNT, photos.length)
    const priorityPhotosLoaded = priorityPhotoLoadCount >= priorityTarget
    const timeoutId = globalThis.setTimeout(
      () => setRenderedPhotoCount(photos.length),
      priorityPhotosLoaded ? 300 : 2500
    )
    return () => globalThis.clearTimeout(timeoutId)
  }, [photos.length, priorityPhotoLoadCount, renderedPhotoCount])

  const markPriorityPhotoLoaded = useCallback((index: number) => {
    if (index >= INITIAL_PHOTO_RENDER_COUNT || loadedPriorityPhotoIndexesRef.current.has(index)) return
    loadedPriorityPhotoIndexesRef.current.add(index)
    setPriorityPhotoLoadCount(loadedPriorityPhotoIndexesRef.current.size)
  }, [])

  const applySheetHeight = useCallback((nextHeight: number, commitState = true) => {
    const height = clamp(nextHeight, SHEET_COLLAPSED, SHEET_EXPANDED)
    currentSheetHeightRef.current = height
    if (sheetRef.current) sheetRef.current.style.height = `${height}svh`
    if (commitState) setSheetHeight(height)
    return height
  }, [])

  const beginSheetDrag = useCallback((clientY: number) => {
    dragRef.current = {
      startY: clientY,
      startHeight: currentSheetHeightRef.current,
    }
  }, [])

  const updateSheetDrag = useCallback((clientY: number) => {
    if (!dragRef.current) return
    const deltaVh = ((dragRef.current.startY - clientY) / window.innerHeight) * 100
    const nextHeight = dragRef.current.startHeight + deltaVh
    pendingSheetHeightRef.current = nextHeight
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current)
    dragFrameRef.current = requestAnimationFrame(() => {
      applySheetHeight(nextHeight, false)
      pendingSheetHeightRef.current = null
    })
  }, [applySheetHeight])

  const finishSheetDrag = useCallback(() => {
    if (!dragRef.current) return
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
    if (pendingSheetHeightRef.current != null) {
      applySheetHeight(pendingSheetHeightRef.current, false)
      pendingSheetHeightRef.current = null
    }
    const current = currentSheetHeightRef.current
    const snap = SHEET_SNAPS.reduce((closest, point) => (
      Math.abs(point - current) < Math.abs(closest - current) ? point : closest
    ), SHEET_COLLAPSED)
    dragRef.current = null
    applySheetHeight(snap, true)
  }, [applySheetHeight])

  const handleSheetScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    if (dragRef.current || currentSheetHeightRef.current !== SHEET_COLLAPSED) return
    if (event.currentTarget.scrollTop > 18) applySheetHeight(SHEET_SCROLL_LIFT, true)
  }, [applySheetHeight])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) return
      event.preventDefault()
      updateSheetDrag(event.clientY)
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (!dragRef.current || event.touches.length === 0) return
      event.preventDefault()
      updateSheetDrag(event.touches[0].clientY)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current) return
      event.preventDefault()
      updateSheetDrag(event.clientY)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', finishSheetDrag)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishSheetDrag)
    window.addEventListener('pointercancel', finishSheetDrag)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', finishSheetDrag)
    window.addEventListener('touchcancel', finishSheetDrag)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', finishSheetDrag)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishSheetDrag)
      window.removeEventListener('pointercancel', finishSheetDrag)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', finishSheetDrag)
      window.removeEventListener('touchcancel', finishSheetDrag)
    }
  }, [finishSheetDrag, updateSheetDrag])

  const handleSheetPointerStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    beginSheetDrag(event.clientY)
  }, [beginSheetDrag])

  const handleSheetPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    updateSheetDrag(event.clientY)
  }, [updateSheetDrag])

  const stepGallery = useCallback((direction: -1 | 1) => {
    if (photos.length === 0) return
    setGalleryIndex((current) => {
      if (current == null) return current
      return (current + direction + photos.length) % photos.length
    })
  }, [photos.length])

  return (
    <section className="fixed inset-0 z-40 block overflow-hidden bg-black text-[#0a0a0b] md:hidden">
      <div
        className="absolute inset-0 overflow-y-auto overscroll-contain bg-black pb-[42svh]"
        data-track-scroll-container
        data-track-section="mobile_photos"
        aria-label="Property photos"
      >
        {photos.length > 0 ? (
          photos.map((src, index) => {
            const isPriorityPhoto = index < 2
            const shouldRenderImage = index < renderedPhotoCount

            return (
              <button
                key={`${src}-${index}`}
                type="button"
                onClick={() => setGalleryIndex(index)}
                aria-label={`Open photo ${index + 1} of ${photos.length}`}
                className={`relative block w-full border-b border-white bg-black text-left ${index === 0 ? 'h-[38svh]' : 'h-[30svh]'}`}
              >
                {shouldRenderImage ? (
                  <Image
                    src={src}
                    alt={`${title} photo ${index + 1}`}
                    fill
                    className="object-cover"
                    sizes="100vw"
                    quality={isPriorityPhoto ? 78 : 68}
                  preload={isPriorityPhoto}
                  loading={isPriorityPhoto ? undefined : 'lazy'}
                  fetchPriority={isPriorityPhoto ? 'high' : 'low'}
                  decoding="async"
                  onLoad={() => markPriorityPhotoLoaded(index)}
                />
                ) : (
                  <span className="absolute inset-0 bg-black" aria-hidden="true" />
                )}
                {index === 0 && <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/10" />}
              </button>
            )
          })
        ) : (
          <div className="flex h-[42svh] items-end bg-[linear-gradient(145deg,#334155,#111827_62%,#020617)] p-6 text-white">
            <div>
              <p className="mb-2 inline-flex rounded-[14px] bg-[#2563eb] px-3 py-1.5 text-[13px] font-bold tracking-wide">FOR SALE</p>
              <h1 className="max-w-[18rem] text-[30px] font-bold leading-tight">{title}</h1>
            </div>
          </div>
        )}
        <div className="h-[34svh]" aria-hidden="true" />
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+14px)]">
        <span
          className="pointer-events-auto inline-flex h-10 items-center rounded-[15px] px-3.5 text-[12px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_rgba(37,99,235,0.28)]"
          style={{ backgroundColor: SALE_BLUE }}
        >
          For Sale
        </span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Save deal"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg backdrop-blur-md transition-transform active:scale-95"
          >
            <IconHeart className="h-6 w-6" />
          </button>
          <ShareButton
            slug={slug}
            ariaLabel="Share deal"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg backdrop-blur-md transition-transform active:scale-95"
            toastClassName="fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#0f0f12] px-5 py-3 text-[13px] font-medium text-white shadow-lg"
          >
            <IconShare className="h-5 w-5" />
          </ShareButton>
        </div>
      </div>

      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-30 overflow-y-auto overscroll-contain rounded-t-[30px] border-t border-[#e5e5ea] bg-white px-5 shadow-[0_-16px_38px_rgba(10,10,11,0.18)] transition-[height] duration-100"
        style={{
          height: `${sheetHeight}svh`,
          colorScheme: 'light',
          WebkitOverflowScrolling: 'touch',
        }}
        onScroll={handleSheetScroll}
        data-track-scroll-container
        data-track-section="mobile_deal_sheet"
      >
        <div className="sticky top-0 z-20 -mx-5 bg-white/96 px-5 pb-3 pt-2 backdrop-blur">
          <button
            type="button"
            aria-label="Resize deal details"
            onPointerDown={handleSheetPointerStart}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={finishSheetDrag}
            onPointerCancel={finishSheetDrag}
            onMouseDown={(event) => beginSheetDrag(event.clientY)}
            onTouchStart={(event) => {
              if (event.touches.length > 0) beginSheetDrag(event.touches[0].clientY)
            }}
            className="mx-auto flex h-7 w-28 touch-none cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
          >
            <span className="h-1.5 w-16 rounded-full bg-[#d1d1d6]" />
          </button>
        </div>

        <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+92px)]">
          <section className="space-y-4">
            <div>
              <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
                {dealPage.show_asking_price !== false && askingPrice != null ? (
                  <h1 className="text-[34px] font-extrabold leading-none tracking-normal text-[#0a0a0b]">{fmt(askingPrice)}</h1>
                ) : (
                  <h1 className="text-[32px] font-extrabold leading-none tracking-normal text-[#0a0a0b]">Price TBD</h1>
                )}
                {dealPage.show_arv !== false && arv != null && (
                  <span className="pb-1 text-[17px] font-extrabold leading-none" style={{ color: ACCENT_RED }}>
                    (ARV: {fmt(arv)})
                  </span>
                )}
              </div>
              <div className="mt-3.5 flex items-start gap-2 text-[17px] font-bold leading-snug text-[#0a0a0b]">
                <IconPin className="mt-0.5 h-5 w-5 shrink-0 text-[#36363d]" />
                <p>{location}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {lead?.beds != null && <Metric icon={<IconBed className="h-6 w-6" />} value={`${lead.beds} Beds`} />}
              {bathValue && <Metric icon={<IconBath className="h-6 w-6" />} value={bathValue} />}
              {lead?.sqft != null && <Metric icon={<IconHome className="h-6 w-6" />} value={`${fmtNum(lead.sqft)} Sq.Ft.`} />}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2.5 border-t border-[#e5e5ea] pt-5" data-track-section="mobile_details">
            {lead?.property_type && <Info label="Type" value={lead.property_type} />}
            {dealPage.parking && <Info label="Parking" value={dealPage.parking} />}
            {lead?.year_built && <Info label="Built in" value={String(lead.year_built)} />}
            {lead?.lot_size && <Info label="Lot size" value={String(lead.lot_size)} />}
            {dealPage.property_condition && <Info label="Condition" value={dealPage.property_condition} />}
            {repairEstimate !== '-' && <Info label="Repairs" value={repairEstimate} />}
          </section>

          <section className="border-t border-[#e5e5ea] pt-5" data-track-section="mobile_overview">
            <h2 className="mb-3 text-[21px] font-extrabold text-[#0a0a0b]">Overview</h2>
            <p className="whitespace-pre-wrap text-[16px] leading-7 text-[#36363d]">
              {overviewText}
            </p>
          </section>

          {hasTerms && (
            <section className="space-y-3 border-t border-[#e5e5ea] pt-5" data-track-section="mobile_terms">
              <h2 className="text-[20px] font-extrabold text-[#0a0a0b]">Contract Terms</h2>
              <div className="grid grid-cols-2 gap-2.5">
                {dealPage.contract_close_date && (
                  <Info
                    label="Close Date"
                    value={fmtDate(dealPage.contract_close_date)}
                  />
                )}
                {dealPage.earnest_money != null && <Info label="EMD" value={fmt(dealPage.earnest_money)} />}
                {dealPage.inspection_period_days != null && <Info label="Inspection" value={`${dealPage.inspection_period_days} days`} />}
                {dealPage.financing_terms && <Info label="Financing" value={dealPage.financing_terms} />}
              </div>
              {dealPage.contract_notes && <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#4f5058]">{dealPage.contract_notes}</p>}
            </section>
          )}

          {videos.length > 0 && (
            <section className="space-y-3 border-t border-[#e5e5ea] pt-5" data-track-section="mobile_videos">
              <h2 className="text-[20px] font-extrabold text-[#0a0a0b]">Videos</h2>
              {videos.map((url, index) => (
                <video key={`${url}-${index}`} controls className="w-full rounded-xl bg-black" preload="metadata">
                  <source src={url} />
                </video>
              ))}
            </section>
          )}

          {inspectionReports.length > 0 && (
            <section className="space-y-2 border-t border-[#e5e5ea] pt-5" data-track-section="mobile_reports">
              <h2 className="text-[20px] font-extrabold text-[#0a0a0b]">Inspection Reports</h2>
              {inspectionReports.map((report, index) => (
                <a
                  key={`${report.url}-${index}`}
                  href={report.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-[10px] border border-[#e5e5ea] bg-white px-4 py-3 text-[14px] font-semibold text-[#0a0a0b]"
                >
                  <span className="truncate">{report.name}</span>
                  <span style={{ color: ACCENT_RED }}>PDF</span>
                </a>
              ))}
            </section>
          )}

          <div className="flex items-center justify-end border-t border-[#e5e5ea] py-4 text-[12px] font-medium text-[#8a8a94]">
            <span>Saving KC Homebuyers</span>
          </div>
        </div>

        {dealPage.accept_offers !== false && (
          <div className="sticky bottom-0 -mx-5 border-t border-[#e5e5ea] bg-white/96 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 backdrop-blur">
            <OfferForm
              slug={slug}
              askingPrice={askingPrice}
              arv={arv}
              earnestMoney={dealPage.earnest_money}
              photo={photos[0]}
              propertyAddress={lead?.property_address || title}
              location={lead ? [lead.city, lead.state, lead.zip].filter(Boolean).join(', ') : ''}
              triggerClassName="w-full rounded-[18px] bg-[#ef4444] px-4 py-3.5 text-[16px] font-extrabold text-white shadow-[0_8px_22px_rgba(239,68,68,0.26)] transition-colors hover:bg-[#dc2626]"
              triggerLabel="Make offer"
            />
          </div>
        )}
      </div>

      {galleryIndex != null && photos[galleryIndex] && (
        <div className="fixed inset-0 z-[80] bg-black text-white" data-track-section="mobile_photo_gallery">
          <button
            type="button"
            onClick={() => setGalleryIndex(null)}
            aria-label="Close gallery"
            className="absolute right-5 top-[calc(env(safe-area-inset-top)+16px)] z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-md"
          >
            <IconCloseSmall className="h-7 w-7" />
          </button>
          <div className="absolute left-5 top-[calc(env(safe-area-inset-top)+24px)] z-10 rounded-full bg-black/45 px-3 py-1 text-[13px] font-semibold backdrop-blur">
            {galleryIndex + 1} / {photos.length}
          </div>
          <img
            src={photos[galleryIndex]}
            alt={`${title} expanded photo ${galleryIndex + 1}`}
            className="h-full w-full object-contain"
          />
          {photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => stepGallery(-1)}
                className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-md"
              >
                <IconChevron className="h-8 w-8" />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => stepGallery(1)}
                className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 rotate-180 items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-md"
              >
                <IconChevron className="h-8 w-8" />
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[16px] border border-[#e5e5ea] bg-[#fafafa] px-3 py-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.08em]" style={{ color: ACCENT_RED }}>{label}</p>
      <p className="mt-1 break-words text-[14px] font-bold leading-5 text-[#0a0a0b]">{value}</p>
    </div>
  )
}
