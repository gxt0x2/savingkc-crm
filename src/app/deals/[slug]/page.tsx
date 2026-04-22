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

  // Stats bar items with flat icons
  const statItems = [
    lead?.beds != null && { label: 'Beds', value: String(lead.beds), icon: <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2V10c0-2.21-1.79-4-4-4z"/></svg> },
    lead?.baths_full != null && { label: 'Baths', value: String(lead.baths_full), icon: <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm13 4h-1V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v1H2v7c0 2.21 1.79 4 4 4v2h2v-2h8v2h2v-2c2.21 0 4-1.79 4-4v-2h-2zm-3-6v1h-4V5h4z"/></svg> },
    lead?.baths_half != null && lead.baths_half > 0 && { label: 'Half-Bath', value: String(lead.baths_half), icon: <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> },
    lead?.sqft && { label: 'Sq.Ft', value: fmtNum(lead.sqft), icon: <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> },
  ].filter(Boolean) as { label: string; value: string; icon: React.ReactNode }[]

  // Additional details grid with flat icons
  const details = [
    { label: 'Type', value: lead?.property_type || '—', icon: <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> },
    { label: 'Parking', value: dealPage.parking || '—', icon: <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg> },
    { label: 'Built', value: lead?.year_built ? String(lead.year_built) : '—', icon: <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg> },
    { label: 'Lot size', value: lead?.lot_size ? String(lead.lot_size) : '—', icon: <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19 12h-2v3h-3v2h5v-5zM7 9h3V7H5v5h2V9zm14-6H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z"/></svg> },
    { label: 'County', value: lead?.county || '—', icon: <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg> },
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
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                <span>
                  {[lead.county, lead.city, lead.state].filter(Boolean).join(', ')}
                  {lead.zip && ` ${lead.zip}`}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>
              {daysOnPage} day{daysOnPage !== 1 ? 's' : ''} on page
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              {viewCount} view{viewCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Stats Bar */}
        {statItems.length > 0 && (
          <div className="flex items-center gap-0 mb-6 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
            {statItems.map((item, i) => (
              <div key={i} className={`flex-1 flex flex-col items-center py-3 ${i > 0 ? 'border-l border-gray-200' : ''}`}>
                {item.icon}
                <p className="text-[11px] text-gray-500 font-medium mt-1">{item.label}</p>
                <p className="text-lg font-bold text-gray-900">{item.value}</p>
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {details.map(({ label, value, icon }) => (
                  <div key={label} className="flex items-start gap-2">
                    <span className="mt-0.5">{icon}</span>
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium">{label}</p>
                      <p className="text-sm font-semibold text-gray-900">{value}</p>
                    </div>
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
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-gray-400 mt-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>
                  <div>
                  <p className="text-[11px] text-gray-400 font-medium uppercase mb-1">Repair Estimate</p>
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
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Repair estimates not yet provided.</p>
              )}
            </section>

            {/* Property Condition */}
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Property Condition & Systems</h2>
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5 0 1.29-.69 2.42-1.73 3.04L15 14h-2v-1.5l1.27-1.27c.6-.36 1.23-1 1.23-1.73 0-1.1-.9-2-2-2s-2 .9-2 2H9.5C9.5 7.57 10.57 6 12 6zm-1.5 10h3v2h-3v-2z"/></svg>
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-1">Property Condition</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {dealPage.property_condition || 'Not specified'}
                  </p>
                </div>
              </div>
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
                      <svg className="w-5 h-5 text-red-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{report.name}</p>
                        <p className="text-xs text-gray-400">PDF</p>
                      </div>
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
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
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
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
