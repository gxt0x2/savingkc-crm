import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import OfferForm from './offer-form'
import ShareButton from './share-button'
import PhotoGallery from './photo-gallery'
import InquiryModal from './inquiry-modal'

export const dynamic = 'force-dynamic'

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

/* ── Outline icon components (thin, strokeWidth 1.5, matching InvestorLift) ── */

function IconBed({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 19v-8.5a1.5 1.5 0 011.5-1.5h4A1.5 1.5 0 0110 10.5V12h4v-1.5A1.5 1.5 0 0115.5 9h4a1.5 1.5 0 011.5 1.5V19M3 19h18M3 17h18M5 9V5.5A1.5 1.5 0 016.5 4H9" /></svg>
}
function IconBath({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M4 12v4a4 4 0 004 4h8a4 4 0 004-4v-4M4 12V7a3 3 0 013-3h0a3 3 0 013 3v1M7 20v1m10-1v1" /></svg>
}
function IconHalfBath({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M4 12v4a4 4 0 004 4h8a4 4 0 004-4v-4M4 12V7a3 3 0 013-3h0a3 3 0 013 3v1M12 16v5" /></svg>
}
function IconHome({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" /></svg>
}
function IconPin({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
}
function IconCar({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.588-.75H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></svg>
}
function IconCalendar({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
}
function IconExpand({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-11.25 11.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" /></svg>
}
function IconWrench({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1 5.1a2.121 2.121 0 11-3-3l5.1-5.1m3-3l1.58-1.58a2.25 2.25 0 013.18 0l.09.09a2.25 2.25 0 010 3.18l-1.58 1.58m-4.27-4.27l4.27 4.27M21 11.25c0 .621-.111 1.216-.315 1.767a2.228 2.228 0 01-1.574-.6l-3.47-3.47a2.228 2.228 0 01-.6-1.574A7.46 7.46 0 0021 11.25zM3 11.25a7.46 7.46 0 015.96-7.317 2.228 2.228 0 01-.6 1.574l-3.47 3.47a2.228 2.228 0 01-1.574.6A7.46 7.46 0 013 11.25z" /></svg>
}
function IconShield({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
}
function IconDoc({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
}
function IconDownload({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
}
function IconEye({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
}
function IconMail({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
}

/* ── Card wrapper — consistent styling ── */
const card = 'bg-white border border-[#eaeaea] rounded-2xl'

export default async function DealPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const db = supabaseAdmin()

  const { data: dealPage, error } = await db
    .from('deal_pages')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (error || !dealPage) return notFound()

  const { data: lead } = await db
    .from('leads')
    .select(
      'property_address, city, state, zip, county, property_type, beds, baths_full, baths_half, sqft, arv, offer_amount, lot_size, year_built'
    )
    .eq('id', dealPage.lead_id)
    .single()

  // Increment view count (fire-and-forget)
  db.from('deal_pages')
    .update({ view_count: (dealPage.view_count || 0) + 1 })
    .eq('id', dealPage.id)
    .then(() => {})

  const title = dealPage.title || lead?.property_address || 'Investment Opportunity'
  const photos: string[] = dealPage.photos || []
  const videos: string[] = dealPage.videos || []
  const inspectionReports: { name: string; url: string; uploaded_at: string }[] = dealPage.inspection_reports || []

  const askingPrice = lead?.offer_amount
  const arv = lead?.arv
  const grossMargin = askingPrice && arv ? arv - askingPrice : null

  const viewCount = (dealPage.view_count || 0) + 1

  // Stats
  const statItems = [
    lead?.beds != null && { label: 'Beds', value: String(lead.beds), icon: <IconBed className="w-6 h-6" /> },
    lead?.baths_full != null && { label: 'Baths', value: String(lead.baths_full), icon: <IconBath className="w-6 h-6" /> },
    lead?.baths_half != null && lead.baths_half > 0 && { label: 'Half-Bath', value: String(lead.baths_half), icon: <IconHalfBath className="w-6 h-6" /> },
    lead?.sqft && { label: 'Sq.Ft', value: fmtNum(lead.sqft), icon: <IconHome className="w-6 h-6" /> },
  ].filter(Boolean) as { label: string; value: string; icon: React.ReactNode }[]

  // Details
  const details = [
    { label: 'Type', value: lead?.property_type || '—', icon: <IconHome className="w-[18px] h-[18px]" /> },
    { label: 'Parking', value: dealPage.parking || '—', icon: <IconCar className="w-[18px] h-[18px]" /> },
    { label: 'Built in', value: lead?.year_built ? String(lead.year_built) : '—', icon: <IconCalendar className="w-[18px] h-[18px]" /> },
    { label: 'Lot size', value: lead?.lot_size ? String(lead.lot_size) : '—', icon: <IconExpand className="w-[18px] h-[18px]" /> },
  ]

  const hasContractTerms = dealPage.contract_close_date || dealPage.earnest_money != null ||
    dealPage.inspection_period_days != null || dealPage.financing_terms ||
    (dealPage.show_assignment_fee && dealPage.assignment_fee != null)

  const hasRepairEstimate = dealPage.repair_estimate_low != null || dealPage.repair_estimate_high != null

  return (
    <div className="min-h-screen bg-white text-[#1a1a1a]" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <header className="border-b border-[#eaeaea]">
        <div className="max-w-[1120px] mx-auto px-6 py-3.5 flex items-center gap-3">
          <img src="/logo.png" alt="Saving KC Homebuyers" className="h-8 w-auto" />
          <span className="text-[11px] font-medium text-teal-600 bg-teal-50 px-2.5 py-0.5 rounded-full tracking-wide">Deal Page</span>
        </div>
      </header>

      <main className="max-w-[1120px] mx-auto px-6 py-8">
        {/* Photo Gallery */}
        <PhotoGallery photos={photos} />

        {/* Location row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
          {dealPage.show_address !== false && lead && (
            <div className="flex items-center gap-1.5 text-[14px] text-[#444]">
              <IconPin className="w-[18px] h-[18px] text-[#999]" />
              <span>
                {[lead.county, lead.city, lead.state].filter(Boolean).join(', ')}
                {lead.zip && ` ${lead.zip}`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-5 text-[13px] text-[#999]">
            <span className="flex items-center gap-1.5">
              <IconEye className="w-[14px] h-[14px]" />
              {viewCount} view{viewCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Main 2-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-5">

            {/* Stats + Overview — combined card */}
            <section className={card}>
              {statItems.length > 0 && (
                <div className="flex">
                  {statItems.map((item, i) => (
                    <div key={i} className={`flex-1 flex items-center gap-3.5 px-6 py-5 ${i > 0 ? 'border-l border-[#f0f0f0]' : ''}`}>
                      <span className="text-[#555]">{item.icon}</span>
                      <div>
                        <p className="text-[13px] text-[#888] leading-none">{item.label}</p>
                        <p className="text-[20px] font-bold text-[#1a1a1a] leading-tight mt-0.5">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {statItems.length > 0 && <div className="border-t border-[#f0f0f0]" />}
              <div className="px-6 py-6">
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-3">Overview</h2>
                <p className="text-[14px] text-[#555] leading-[1.7] whitespace-pre-wrap">
                  {dealPage.description || 'No description provided.'}
                </p>
              </div>
            </section>

            {/* Additional details */}
            <section className={`${card} px-6 py-6`}>
              <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-5">Additional details</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-5 gap-x-4">
                {details.map(({ label, value, icon }) => (
                  <div key={label} className="flex items-start gap-2.5">
                    <span className="text-[#999] mt-0.5">{icon}</span>
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">{label}</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Property Condition & Systems */}
            <section className={`${card} px-6 py-6`}>
              <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-4">Property Condition & Systems</h2>
              <div className="flex items-start gap-2.5">
                <IconShield className="w-[18px] h-[18px] text-[#999] mt-0.5" />
                <div>
                  <p className="text-[13px] text-[#888] leading-none">Property Condition</p>
                  <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">
                    {dealPage.property_condition || 'Not specified'}
                  </p>
                </div>
              </div>
            </section>

            {/* Financing Information */}
            <section className={`${card} px-6 py-6`}>
              <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-4">Financing Information</h2>
              {hasRepairEstimate ? (
                <div className="flex items-start gap-2.5">
                  <IconWrench className="w-[18px] h-[18px] text-[#999] mt-0.5" />
                  <div>
                    <p className="text-[13px] text-[#888] leading-none">Repair Estimate</p>
                    {dealPage.repair_estimate_low != null && dealPage.repair_estimate_high != null ? (
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">
                        {fmt(dealPage.repair_estimate_low)} - {fmt(dealPage.repair_estimate_high)}
                      </p>
                    ) : (
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">
                        {fmt(dealPage.repair_estimate_low ?? dealPage.repair_estimate_high)}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[14px] text-[#999]">Repair estimates not yet provided.</p>
              )}
            </section>

            {/* Contract Terms */}
            {hasContractTerms && (
              <section className={`${card} px-6 py-6`}>
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-5">Contract Terms</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-4">
                  {dealPage.contract_close_date && (
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">Close Date</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">
                        {new Date(dealPage.contract_close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  )}
                  {dealPage.earnest_money != null && (
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">Earnest Money</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">{fmt(dealPage.earnest_money)}</p>
                    </div>
                  )}
                  {dealPage.inspection_period_days != null && (
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">Inspection Period</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">{dealPage.inspection_period_days} days</p>
                    </div>
                  )}
                  {dealPage.financing_terms && (
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">Financing</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">{dealPage.financing_terms}</p>
                    </div>
                  )}
                  {dealPage.show_assignment_fee && dealPage.assignment_fee != null && (
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">Assignment Fee</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">{fmt(dealPage.assignment_fee)}</p>
                    </div>
                  )}
                </div>
                {dealPage.contract_notes && (
                  <p className="text-[14px] text-[#666] mt-5 pt-5 border-t border-[#f0f0f0] leading-[1.7]">{dealPage.contract_notes}</p>
                )}
              </section>
            )}

            {/* Videos */}
            {videos.length > 0 && (
              <section className={`${card} px-6 py-6`}>
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-4">Videos</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videos.map((url, i) => (
                    <video key={i} controls className="w-full rounded-xl" preload="metadata">
                      <source src={url} />
                    </video>
                  ))}
                </div>
              </section>
            )}

            {/* Inspection Reports */}
            {inspectionReports.length > 0 && (
              <section className={`${card} px-6 py-6`}>
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-4">Inspection Reports</h2>
                <div className="space-y-2">
                  {inspectionReports.map((report, i) => (
                    <a
                      key={i}
                      href={report.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#f0f0f0] hover:border-[#ddd] hover:bg-[#fafafa] transition-all"
                    >
                      <IconDoc className="w-5 h-5 text-red-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-[#1a1a1a] truncate">{report.name}</p>
                        <p className="text-[12px] text-[#999]">PDF</p>
                      </div>
                      <IconDownload className="w-4 h-4 text-[#bbb] flex-shrink-0" />
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* RIGHT SIDEBAR */}
          <div className="space-y-5">
            {/* Pricing Card */}
            <div className={`${card} p-6 sticky top-6`}>
              {dealPage.show_asking_price !== false && askingPrice && (
                <div className="mb-5">
                  <p className="text-[13px] text-[#888] mb-1">Price</p>
                  <p className="text-[28px] font-bold text-[#1a1a1a] tracking-tight">{fmt(askingPrice)}</p>
                </div>
              )}

              <div className="space-y-3 mb-6">
                {dealPage.show_arv !== false && arv && (
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] text-[#888]">ARV</span>
                    <span className="text-[14px] font-semibold text-[#1a1a1a]">{fmt(arv)}</span>
                  </div>
                )}
                {dealPage.show_arv !== false && grossMargin && grossMargin > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] text-[#888]">Gross margin</span>
                    <span className="text-[14px] font-semibold text-[#1a1a1a]">{fmt(grossMargin)}</span>
                  </div>
                )}
                {dealPage.show_assignment_fee && dealPage.assignment_fee != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] text-[#888]">Assignment Fee</span>
                    <span className="text-[14px] font-semibold text-[#1a1a1a]">{fmt(dealPage.assignment_fee)}</span>
                  </div>
                )}
              </div>

              {/* CTA Buttons */}
              <div className="space-y-2.5">
                {dealPage.accept_offers && (
                  <OfferForm
                    slug={slug}
                    askingPrice={askingPrice}
                    arv={arv}
                    photo={photos[0]}
                    propertyAddress={lead?.property_address || title}
                    location={lead ? [lead.city, lead.state, lead.zip].filter(Boolean).join(', ') : ''}
                  />
                )}
                <ShareButton />
              </div>
            </div>

            {/* Wholesaler Card */}
            <div className={`${card} p-6`}>
              <div className="flex flex-col items-center text-center mb-4">
                <img src="/ernest-profile.png" alt="Ernest Dodson" className="w-14 h-14 rounded-full object-cover mb-3" />
                <p className="text-[15px] font-semibold text-[#1a1a1a]">Ernest Dodson</p>
                <p className="text-[13px] text-[#888] mt-0.5">Saving KC Homebuyers</p>
              </div>
              <InquiryModal propertyAddress={lead?.property_address || title} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-16 pb-8">
          <p className="text-[12px] text-[#ccc]">
            Powered by Saving KC Homebuyers
          </p>
        </div>
      </main>
    </div>
  )
}
