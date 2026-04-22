import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import OfferForm from './offer-form'
import ShareButton from './share-button'
import PhotoGallery from './photo-gallery'

export const dynamic = 'force-dynamic'

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
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

  const daysOnPage = daysSince(dealPage.created_at)
  const viewCount = (dealPage.view_count || 0) + 1

  // Stats bar items
  const statItems = [
    lead?.beds != null && { label: 'Beds', value: String(lead.beds) },
    lead?.baths_full != null && { label: 'Baths', value: String(lead.baths_full) },
    lead?.baths_half != null && lead.baths_half > 0 && { label: 'Half Bath', value: String(lead.baths_half) },
    lead?.sqft && { label: 'Sq Ft', value: fmtNum(lead.sqft) },
  ].filter(Boolean) as { label: string; value: string }[]

  // Additional details grid
  const details = [
    { label: 'Property Type', value: lead?.property_type || '—' },
    { label: 'Parking', value: dealPage.parking || '—' },
    { label: 'Year Built', value: lead?.year_built ? String(lead.year_built) : '—' },
    { label: 'Lot Size', value: lead?.lot_size ? String(lead.lot_size) : '—' },
    { label: 'County', value: lead?.county || '—' },
  ]

  // Contract terms data
  const hasContractTerms = dealPage.contract_close_date || dealPage.earnest_money != null ||
    dealPage.inspection_period_days != null || dealPage.financing_terms ||
    (dealPage.show_assignment_fee && dealPage.assignment_fee != null)

  // Repair estimate
  const hasRepairEstimate = dealPage.repair_estimate_low != null || dealPage.repair_estimate_high != null

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <img src="/logo.png" alt="Saving KC Homebuyers" className="h-8 w-auto" />
          <span className="text-[11px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">Deal Page</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Photo Gallery with Lightbox */}
        <PhotoGallery photos={photos} />

        {/* Location + Stats Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">{title}</h1>
            {dealPage.show_address !== false && lead && (
              <div className="flex items-center gap-1.5 mt-1 text-gray-500 text-sm">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>
                  {[lead.county, lead.city, lead.state].filter(Boolean).join(', ')}
                  {lead.zip && ` ${lead.zip}`}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>{daysOnPage} day{daysOnPage !== 1 ? 's' : ''} on page</span>
            <span>{viewCount} view{viewCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Stats Bar */}
        {statItems.length > 0 && (
          <div className="flex items-center gap-0 mb-6 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
            {statItems.map((item, i) => (
              <div key={i} className={`flex-1 text-center py-3 ${i > 0 ? 'border-l border-gray-200' : ''}`}>
                <p className="text-lg font-bold text-gray-900">{item.value}</p>
                <p className="text-[11px] text-gray-500 font-medium">{item.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Main 2-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            {/* Overview / Description */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Overview</h2>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {dealPage.description || 'No description provided.'}
              </p>
            </section>

            {/* Additional Details */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Additional Details</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {details.map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[11px] text-gray-400 font-medium uppercase">{label}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Contract Terms */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Contract Terms</h2>
              {hasContractTerms ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {dealPage.contract_close_date && (
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium uppercase">Close Date</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">
                        {new Date(dealPage.contract_close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  )}
                  {dealPage.earnest_money != null && (
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium uppercase">Earnest Money</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(dealPage.earnest_money)}</p>
                    </div>
                  )}
                  {dealPage.inspection_period_days != null && (
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium uppercase">Inspection Period</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{dealPage.inspection_period_days} days</p>
                    </div>
                  )}
                  {dealPage.financing_terms && (
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium uppercase">Financing</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{dealPage.financing_terms}</p>
                    </div>
                  )}
                  {dealPage.show_assignment_fee && dealPage.assignment_fee != null && (
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium uppercase">Assignment Fee</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(dealPage.assignment_fee)}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Contract terms not yet provided.</p>
              )}
              {dealPage.contract_notes && (
                <p className="text-sm text-gray-500 mt-4 pt-4 border-t border-gray-100">{dealPage.contract_notes}</p>
              )}
            </section>

            {/* Financing / Repair Estimate */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Financing Info</h2>
              {hasRepairEstimate ? (
                <div>
                  <p className="text-[11px] text-gray-400 font-medium uppercase mb-1">Estimated Repair Cost</p>
                  {dealPage.repair_estimate_low != null && dealPage.repair_estimate_high != null ? (
                    <p className="text-lg font-bold text-gray-900">
                      {fmt(dealPage.repair_estimate_low)} – {fmt(dealPage.repair_estimate_high)}
                    </p>
                  ) : (
                    <p className="text-lg font-bold text-gray-900">
                      {fmt(dealPage.repair_estimate_low ?? dealPage.repair_estimate_high)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Repair estimates not yet provided.</p>
              )}
            </section>

            {/* Property Condition */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Property Condition</h2>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {dealPage.property_condition || 'Condition details not yet provided.'}
              </p>
            </section>

            {/* Videos */}
            {videos.length > 0 && (
              <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Videos</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videos.map((url, i) => (
                    <video key={i} controls className="w-full rounded-lg" preload="metadata">
                      <source src={url} />
                    </video>
                  ))}
                </div>
              </section>
            )}

            {/* Inspection Reports */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Inspection Reports</h2>
              {inspectionReports.length > 0 ? (
                <div className="space-y-2">
                  {inspectionReports.map((report, i) => (
                    <a
                      key={i}
                      href={report.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{report.name}</p>
                        <p className="text-xs text-gray-400">PDF</p>
                      </div>
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No inspection reports uploaded.</p>
              )}
            </section>
          </div>

          {/* RIGHT SIDEBAR */}
          <div className="space-y-4">
            {/* Pricing Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm sticky top-6">
              {dealPage.show_asking_price !== false && askingPrice && (
                <div className="mb-4">
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Price</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{fmt(askingPrice)}</p>
                </div>
              )}

              <div className="space-y-3 mb-5">
                {dealPage.show_arv !== false && arv && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">ARV</span>
                    <span className="text-sm font-bold text-gray-900">{fmt(arv)}</span>
                  </div>
                )}
                {dealPage.show_arv !== false && grossMargin && grossMargin > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Gross Margin</span>
                    <span className="text-sm font-bold text-emerald-600">{fmt(grossMargin)}</span>
                  </div>
                )}
                {dealPage.show_assignment_fee && dealPage.assignment_fee != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Assignment Fee</span>
                    <span className="text-sm font-bold text-gray-900">{fmt(dealPage.assignment_fee)}</span>
                  </div>
                )}
              </div>

              {/* CTA Buttons */}
              <div className="space-y-2">
                {dealPage.accept_offers && (
                  <OfferForm slug={slug} askingPrice={askingPrice} />
                )}
                <ShareButton />
              </div>
            </div>

            {/* Wholesaler Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center">
                  <span className="text-lg font-bold text-teal-700">SK</span>
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">Saving KC Homebuyers</p>
                  <p className="text-xs text-gray-500">Kansas City, MO</p>
                </div>
              </div>
              <a
                href="mailto:deals@savingkc.com"
                className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send Inquiry
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-12 pb-6">
          <p className="text-xs text-gray-400">
            Powered by Saving KC Homebuyers
          </p>
        </div>
      </main>
    </div>
  )
}
