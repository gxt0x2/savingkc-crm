import OfferForm from './offer-form'
import ShareButton from './share-button'
import type { ReactNode } from 'react'

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
  grossMargin: number | null
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '-'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString('en-US')
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Recently'
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 60) return `${days} days ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
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

function IconClose({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
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

function IconEye({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
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

function Metric({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-[16px] font-semibold text-[#151515]">
      <span className="text-[#111]">{icon}</span>
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
  grossMargin,
}: MobileDealPageProps) {
  const showAddress = dealPage.show_address !== false
  const location = addressLine(lead, showAddress)
  const fullAddress = addressLine(lead, true)
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
  const bathValue = bathText(lead?.baths_full, lead?.baths_half)
  const repairEstimate = dealPage.repair_estimate_low != null && dealPage.repair_estimate_high != null
    ? `${fmt(dealPage.repair_estimate_low)} - ${fmt(dealPage.repair_estimate_high)}`
    : fmt(dealPage.repair_estimate_low ?? dealPage.repair_estimate_high)
  const hasTerms = dealPage.contract_close_date || dealPage.earnest_money != null || dealPage.inspection_period_days != null || dealPage.financing_terms

  return (
    <section className="fixed inset-0 z-40 block overflow-hidden bg-black text-[#111] md:hidden">
      <div
        className="absolute inset-0 overflow-y-auto overscroll-contain bg-black pb-[62svh]"
        data-track-scroll-container
        data-track-section="mobile_photos"
        aria-label="Property photos"
      >
        {photos.length > 0 ? (
          photos.map((src, index) => (
            <figure key={`${src}-${index}`} className={`relative border-b border-white ${index === 0 ? 'h-[48svh]' : 'h-[34svh]'}`}>
              <img
                src={src}
                alt={`${title} photo ${index + 1}`}
                className="h-full w-full object-cover"
                loading={index === 0 ? 'eager' : 'lazy'}
              />
              {index === 0 && (
                <>
                  <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/10" />
                  <span className="absolute left-24 top-24 rounded-md bg-[#2563eb] px-4 py-2 text-[16px] font-bold tracking-wide text-white shadow-lg">
                    FOR SALE
                  </span>
                </>
              )}
            </figure>
          ))
        ) : (
          <div className="flex h-[55svh] items-end bg-[linear-gradient(145deg,#334155,#111827_62%,#020617)] p-6 text-white">
            <div>
              <p className="mb-2 inline-flex rounded-md bg-[#2563eb] px-3 py-1.5 text-[13px] font-bold tracking-wide">FOR SALE</p>
              <h1 className="max-w-[18rem] text-[30px] font-bold leading-tight">{title}</h1>
            </div>
          </div>
        )}
        <div className="h-[42svh]" aria-hidden="true" />
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+16px)]">
        <a
          href="https://savingkc.com"
          aria-label="Close"
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/88 text-black shadow-lg backdrop-blur-md"
        >
          <IconClose className="h-7 w-7" />
        </a>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Save deal"
            className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/88 text-black shadow-lg backdrop-blur-md"
          >
            <IconHeart className="h-7 w-7" />
          </button>
          <ShareButton
            slug={slug}
            ariaLabel="Share deal"
            className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/88 text-black shadow-lg backdrop-blur-md"
            toastClassName="fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#111] px-5 py-3 text-[13px] font-medium text-white shadow-lg"
          >
            <IconShare className="h-6 w-6" />
          </ShareButton>
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 max-h-[64svh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-[#fbfdf8] px-5 pt-3 shadow-[0_-18px_40px_rgba(0,0,0,0.28)]"
        data-track-scroll-container
        data-track-section="mobile_deal_sheet"
      >
        <div className="mx-auto mb-6 h-1 w-14 rounded-full bg-[#d4d8d0]" />

        <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+92px)]">
          <div>
            <div className="flex items-baseline gap-2">
              {dealPage.show_asking_price !== false && askingPrice != null ? (
                <h1 className="text-[40px] font-semibold leading-none tracking-normal text-[#101010]">{fmt(askingPrice)}</h1>
              ) : (
                <h1 className="text-[34px] font-semibold leading-none tracking-normal text-[#101010]">Price TBD</h1>
              )}
              {dealPage.show_arv !== false && arv != null && (
                <span className="text-[22px] font-semibold leading-none text-[#1d4ed8]">(ARV: {fmt(arv)})</span>
              )}
            </div>
            <div className="mt-4 flex items-start gap-2 text-[19px] font-semibold leading-snug text-[#151515]">
              <IconPin className="mt-0.5 h-5 w-5 shrink-0 text-[#1f2937]" />
              <p>{location}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {lead?.beds != null && <Metric icon={<IconBed className="h-6 w-6" />} value={`${lead.beds} Beds`} />}
            {bathValue && <Metric icon={<IconBath className="h-6 w-6" />} value={bathValue} />}
            {lead?.sqft != null && <Metric icon={<IconHome className="h-6 w-6" />} value={`${fmtNum(lead.sqft)} Sq.Ft.`} />}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[18px] font-medium text-[#929292]">{timeAgo(dealPage.created_at)}</span>
            {showAddress && lead?.property_address ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#2563eb] px-3 py-2 text-[15px] font-bold text-white shadow-sm"
              >
                <IconEye className="h-4 w-4" />
                View Full Address
              </a>
            ) : (
              <span className="rounded-md border border-[#cfd7e6] px-3 py-2 text-[13px] font-bold text-[#1d4ed8]">Address hidden</span>
            )}
          </div>

          {dealPage.show_arv !== false && grossMargin != null && grossMargin > 0 && (
            <div className="text-[22px] font-semibold text-[#111]">
              Gross margin: <span className="text-[#0f766e]">{fmt(grossMargin)}</span>
            </div>
          )}

          <section className="border-t border-[#e2e7dd] pt-4" data-track-section="mobile_overview">
            <h2 className="mb-2 text-[18px] font-bold text-[#111]">{title}</h2>
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#3f463f]">
              {dealPage.description || 'No description provided.'}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3 border-t border-[#e2e7dd] pt-4" data-track-section="mobile_details">
            {lead?.property_type && <Info label="Type" value={lead.property_type} />}
            {dealPage.parking && <Info label="Parking" value={dealPage.parking} />}
            {lead?.year_built && <Info label="Built" value={String(lead.year_built)} />}
            {lead?.lot_size && <Info label="Lot" value={String(lead.lot_size)} />}
            {dealPage.property_condition && <Info label="Condition" value={dealPage.property_condition} />}
            {repairEstimate !== '-' && <Info label="Repairs" value={repairEstimate} />}
          </section>

          {hasTerms && (
            <section className="space-y-3 border-t border-[#e2e7dd] pt-4" data-track-section="mobile_terms">
              <h2 className="text-[17px] font-bold text-[#111]">Contract Terms</h2>
              <div className="grid grid-cols-2 gap-3">
                {dealPage.contract_close_date && (
                  <Info
                    label="Close Date"
                    value={new Date(dealPage.contract_close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  />
                )}
                {dealPage.earnest_money != null && <Info label="EMD" value={fmt(dealPage.earnest_money)} />}
                {dealPage.inspection_period_days != null && <Info label="Inspection" value={`${dealPage.inspection_period_days} days`} />}
                {dealPage.financing_terms && <Info label="Financing" value={dealPage.financing_terms} />}
              </div>
              {dealPage.contract_notes && <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#4b554d]">{dealPage.contract_notes}</p>}
            </section>
          )}

          {videos.length > 0 && (
            <section className="space-y-3 border-t border-[#e2e7dd] pt-4" data-track-section="mobile_videos">
              <h2 className="text-[17px] font-bold text-[#111]">Videos</h2>
              {videos.map((url, index) => (
                <video key={`${url}-${index}`} controls className="w-full rounded-xl bg-black" preload="metadata">
                  <source src={url} />
                </video>
              ))}
            </section>
          )}

          {inspectionReports.length > 0 && (
            <section className="space-y-2 border-t border-[#e2e7dd] pt-4" data-track-section="mobile_reports">
              <h2 className="text-[17px] font-bold text-[#111]">Inspection Reports</h2>
              {inspectionReports.map((report, index) => (
                <a
                  key={`${report.url}-${index}`}
                  href={report.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-[#d9dfd3] bg-white px-4 py-3 text-[14px] font-semibold text-[#111]"
                >
                  <span className="truncate">{report.name}</span>
                  <span className="text-[#2563eb]">PDF</span>
                </a>
              ))}
            </section>
          )}

          <div className="flex items-center justify-end border-t border-[#e2e7dd] py-4 text-[12px] font-medium text-[#9a9f96]">
            <span>Saving KC Homebuyers</span>
          </div>
        </div>

        {dealPage.accept_offers !== false && (
          <div className="sticky bottom-0 -mx-5 bg-[#fbfdf8]/96 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 backdrop-blur">
            <OfferForm
              slug={slug}
              askingPrice={askingPrice}
              arv={arv}
              photo={photos[0]}
              propertyAddress={lead?.property_address || title}
              location={lead ? [lead.city, lead.state, lead.zip].filter(Boolean).join(', ') : ''}
              triggerClassName="w-full rounded-md border-2 border-[#1d4ed8] bg-white px-4 py-4 text-[18px] font-semibold text-[#1d4ed8] shadow-sm transition-colors hover:bg-[#eff6ff]"
              triggerLabel="Make offer"
            />
          </div>
        )}
      </div>
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/80 px-3 py-3 ring-1 ring-[#e3e8dc]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#879080]">{label}</p>
      <p className="mt-1 break-words text-[14px] font-semibold leading-5 text-[#161a16]">{value}</p>
    </div>
  )
}
