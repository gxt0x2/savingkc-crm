import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import OfferForm from './offer-form'
import ShareButton from './share-button'
import PhotoGallery from './photo-gallery'
import InquiryModal from './inquiry-modal'
import { DealTracker } from './tracker'
import { DealDocumentLink } from './deal-document-link'
import { DealVideo } from './deal-video'
import MobileDealPage from './mobile-deal-page'

export const dynamic = 'force-dynamic'

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

function fmtDate(dateValue: string): string {
  const [year, month, day] = dateValue.split('T')[0].split('-').map(Number)
  if (year && month && day) {
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function displayDescription(description: string | null): string {
  if (!description) return 'No description provided.'
  const cleaned = description
    .replace(/\s+with\s+\$?[\d,]+\s+ARV\b\.?/gi, '.')
    .replace(/\s*\(?ARV:\s*\$?[\d,]+\)?/gi, '')
    .split(/\r?\n/)
    .filter((line) => !/gross\s*margin|^\s*ARV\b/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned || 'No description provided.'
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
function IconWarningTriangle({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 21 19.5H3L12 3.75Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4.25M12 16.25h.01" /></svg>
}
/* ── Card wrapper — consistent styling ── */
const card = 'bg-white border border-[#eaeaea] rounded-2xl'
const TEST_DEAL_SLUG = '28_iezio'
type DealStatus = 'active' | 'pending' | 'closed'
type PublicLead = {
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
  offer_amount: number | null
  lot_size: number | null
  year_built: number | null
}

const DEAL_STATUS_META: Record<DealStatus, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  pending: {
    label: 'Pending',
    className: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  closed: {
    label: 'Closed',
    className: 'border-slate-300 bg-slate-100 text-slate-700',
  },
}

function testInspectionReport(slug: string) {
  return {
    name: 'Test Inspection Report',
    url: `/api/deals/${slug}/test-inspection-report`,
    uploaded_at: '2026-05-25T00:00:00.000Z',
  }
}

function buildLocationLine(
  lead: { property_address: string | null; city: string | null; state: string | null; zip: string | null; county: string | null } | null,
  showAddress: boolean
): string {
  if (!lead) return 'Kansas City area'
  if (showAddress && lead.property_address) {
    const cityState = [lead.city, lead.state].filter(Boolean).join(', ')
    return `${lead.property_address}${cityState ? `, ${cityState}` : ''}${lead.zip ? ` ${lead.zip}` : ''}`
  }
  return `${[lead.county, lead.city, lead.state].filter(Boolean).join(', ')}${lead.zip ? ` ${lead.zip}` : ''}` || 'Kansas City area'
}

function deriveDealStatus({
  isActive,
  dispoStage,
  tcStatus,
}: {
  isActive?: boolean | null
  dispoStage?: string | null
  tcStatus?: string | null
}): DealStatus {
  const stage = (dispoStage || '').toLowerCase()
  const tc = (tcStatus || '').toLowerCase()

  if (!isActive || stage === 'closed' || stage === 'dead' || tc === 'closed') {
    return 'closed'
  }

  return 'active'
}

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
      'property_address, city, state, zip, county, property_type, beds, baths_full, baths_half, sqft, offer_amount, lot_size, year_built'
    )
    .eq('id', dealPage.lead_id)
    .single<PublicLead>()

  const { data: leadPhotoDocs } = await db
    .from('documents')
    .select('id, mime_type')
    .eq('entity_type', 'lead')
    .eq('entity_id', dealPage.lead_id)
    .eq('doc_type', 'photos')
    .order('uploaded_at', { ascending: false })

  const fallbackPhotos = (leadPhotoDocs || [])
    .filter((doc) => typeof doc.id === 'string' && String(doc.mime_type || '').startsWith('image/'))
    .map((doc) => `/api/documents/${doc.id}/download?preview=1`)

  let dispoStage: string | null = null
  let tcStatus: string | null = null

  const { data: workflowDeal } = await db
    .from('dispo_deals')
    .select('id, stage')
    .eq('lead_id', dealPage.lead_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (workflowDeal) {
    dispoStage = typeof workflowDeal.stage === 'string' ? workflowDeal.stage : null
  }

  if (workflowDeal?.id) {
    const { data: workflowTcFile } = await db
      .from('tc_files')
      .select('status')
      .eq('dispo_deal_id', workflowDeal.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    tcStatus = typeof workflowTcFile?.status === 'string' ? workflowTcFile.status : null
  }

  // Increment view count (fire-and-forget)
  db.from('deal_pages')
    .update({ view_count: (dealPage.view_count || 0) + 1 })
    .eq('id', dealPage.id)
    .then(() => {})

  const title = dealPage.title || lead?.property_address || 'Investment Opportunity'
  const photos: string[] = Array.isArray(dealPage.photos) && dealPage.photos.length > 0
    ? dealPage.photos
    : fallbackPhotos
  const videos: string[] = dealPage.videos || []
  const dbInspectionReports: { name: string; url: string; uploaded_at: string }[] = dealPage.inspection_reports || []
  const inspectionReports = dbInspectionReports.length > 0
    ? dbInspectionReports
    : slug === TEST_DEAL_SLUG
      ? [testInspectionReport(slug)]
      : []

  const askingPrice = dealPage.asking_price ?? null
  const overviewText = displayDescription(dealPage.description)
  const locationLine = buildLocationLine(lead, dealPage.show_address !== false)
  const dealStatus = deriveDealStatus({
    isActive: dealPage.is_active,
    dispoStage,
    tcStatus,
  })
  const statusMeta = DEAL_STATUS_META[dealStatus]

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
  const primaryInspectionReport = inspectionReports[0] ?? null

  return (
    <div className="min-h-screen bg-white text-[#1a1a1a]" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <DealTracker slug={slug} />
      <MobileDealPage
        slug={slug}
        title={title}
        dealPage={dealPage}
        lead={lead}
        photos={photos}
        videos={videos}
        inspectionReports={inspectionReports}
        askingPrice={askingPrice}
        dealStatus={dealStatus}
      />

      <div className="hidden md:block">
      <main className="max-w-[1120px] mx-auto px-6 py-8">
        <div className="mb-4 flex justify-end">
          <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${statusMeta.className}`}>
            {statusMeta.label}
          </span>
        </div>

        {/* Photo Gallery */}
        <PhotoGallery
          photos={photos}
          propertyAddress={lead?.property_address ?? undefined}
          city={lead?.city ?? undefined}
          state={lead?.state ?? undefined}
          zip={lead?.zip ?? undefined}
          county={lead?.county ?? undefined}
          showAddress={dealPage.show_address !== false}
          slug={slug}
        />

        {/* Location row — full address */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
          {lead && (
            <div className="flex items-center gap-1.5 text-[14px] text-[#444]">
              <IconPin className="w-[18px] h-[18px] text-[#999]" />
              <span>
                {locationLine}
              </span>
            </div>
          )}
        </div>

        {/* Main 2-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-5">

            {/* Stats + Overview — combined card */}
            <section className={card} data-track-section="overview">
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
                  {overviewText}
                </p>
              </div>
            </section>

            {/* Additional details */}
            <section className={`${card} px-6 py-6`} data-track-section="details">
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
            <section className={`${card} px-6 py-6`} data-track-section="condition">
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
            <section className={`${card} px-6 py-6`} data-track-section="financing">
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
              <section className={`${card} px-6 py-6`} data-track-section="contract">
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-5">Contract Terms</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-4">
                  {dealPage.contract_close_date && (
                    <div>
                      <p className="text-[13px] text-[#888] leading-none">Close Date</p>
                      <p className="text-[14px] font-medium text-[#1a1a1a] mt-1">
                        {fmtDate(dealPage.contract_close_date)}
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
              <section className={`${card} px-6 py-6`} data-track-section="videos">
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-4">Videos</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videos.map((url, i) => (
                    <DealVideo key={url || i} slug={slug} url={url} index={i} />
                  ))}
                </div>
              </section>
            )}

            {/* Inspection Reports */}
            {inspectionReports.length > 0 && (
              <section className={`${card} px-6 py-6`} data-track-section="documents">
                <h2 className="text-[17px] font-semibold text-[#1a1a1a] mb-4">Inspection Reports</h2>
                <div className="space-y-2">
                  {inspectionReports.map((report, i) => (
                    <DealDocumentLink
                      key={`${report.url}-${i}`}
                      slug={slug}
                      name={report.name}
                      url={report.url}
                      index={i}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* RIGHT SIDEBAR */}
          <div className="space-y-5 lg:sticky lg:self-start" style={{ top: 'max(24px, calc(50vh - 220px))' }}>
            {/* Pricing Card */}
            <div className={`${card} p-6`}>
              {dealPage.show_asking_price !== false && askingPrice && (
                <div className="mb-5">
                  <p className="text-[13px] text-[#888] mb-1">Price</p>
                  <p className="text-[28px] font-bold text-[#1a1a1a] tracking-tight">{fmt(askingPrice)}</p>
                </div>
              )}

              <div className="space-y-3 mb-6">
                {dealPage.show_assignment_fee && dealPage.assignment_fee != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] text-[#888]">Assignment Fee</span>
                    <span className="text-[14px] font-semibold text-[#1a1a1a]">{fmt(dealPage.assignment_fee)}</span>
                  </div>
                )}
              </div>

              {/* CTA Buttons */}
              <div className="space-y-2.5">
                {primaryInspectionReport && (
                  <a
                    href={primaryInspectionReport.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-[14px] font-semibold text-[#c2410c] shadow-[0_6px_18px_rgba(249,115,22,0.12)] transition-all hover:border-[#fdba74] hover:bg-[#ffedd5]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <IconWarningTriangle className="h-5 w-5 shrink-0" />
                      <span className="truncate">Inspection Report</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ea580c]">View Report</span>
                  </a>
                )}
                {dealPage.accept_offers && (
                  <OfferForm
                    slug={slug}
                    askingPrice={askingPrice}
                    photo={photos[0]}
                    propertyAddress={lead?.property_address || title}
                    location={lead ? [lead.city, lead.state, lead.zip].filter(Boolean).join(', ') : ''}
                  />
                )}
                <ShareButton slug={slug} />
              </div>
            </div>

            {/* Wholesaler Card */}
            <div className={`${card} p-6`}>
              <div className="flex flex-col items-center text-center mb-4">
                <img src="/ernest-profile.png" alt="Ernest Dodson" className="w-14 h-14 rounded-full object-cover mb-3" />
                <p className="text-[15px] font-semibold text-[#1a1a1a]">Ernest Dodson</p>
                <p className="text-[13px] text-[#888] mt-0.5">Saving KC Homebuyers</p>
              </div>
              <InquiryModal propertyAddress={lead?.property_address || title} slug={slug} />
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
    </div>
  )
}
