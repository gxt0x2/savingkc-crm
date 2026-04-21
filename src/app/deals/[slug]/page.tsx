import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

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

  // Fetch lead property details
  const { data: lead } = await db
    .from('leads')
    .select(
      'property_address, city, state, zip, county, property_type, beds, baths_full, sqft, arv, offer_amount, lot_size, year_built'
    )
    .eq('id', dealPage.lead_id)
    .single()

  // Increment view count (fire-and-forget)
  db.from('deal_pages')
    .update({ view_count: (dealPage.view_count || 0) + 1 })
    .eq('id', dealPage.id)
    .then(() => {})

  const title = dealPage.title || lead?.property_address || 'Investment Opportunity'
  const addr = lead?.property_address
  const cityState = [lead?.city, lead?.state].filter(Boolean).join(', ')
  const zip = lead?.zip

  function fmt(n: number | null | undefined): string {
    if (n == null) return '—'
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }

  const details = [
    lead?.property_type && { label: 'Property Type', value: lead.property_type },
    lead?.beds && { label: 'Bedrooms', value: String(lead.beds) },
    lead?.baths_full && { label: 'Bathrooms', value: String(lead.baths_full) },
    lead?.sqft && { label: 'Sqft', value: Number(lead.sqft).toLocaleString() },
    lead?.lot_size && { label: 'Lot Size', value: lead.lot_size },
    lead?.year_built && { label: 'Year Built', value: String(lead.year_built) },
    lead?.county && { label: 'County', value: lead.county },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#141414]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src="/logo.png" alt="Saving KC Homebuyers" className="h-8 w-auto" />
          <span className="text-xs text-white/50 font-medium">Deal Page</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
          {dealPage.show_address !== false && addr && (
            <p className="text-white/60 mt-1">
              {addr}
              {cityState && `, ${cityState}`}
              {zip && ` ${zip}`}
            </p>
          )}
        </div>

        {/* Description */}
        {dealPage.description && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <p className="text-sm text-white/80 whitespace-pre-wrap">{dealPage.description}</p>
          </div>
        )}

        {/* Financials */}
        <div className="grid grid-cols-2 gap-3">
          {dealPage.show_arv !== false && lead?.arv && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1">After Repair Value</p>
              <p className="text-xl font-bold text-emerald-400">{fmt(lead.arv)}</p>
            </div>
          )}
          {dealPage.show_asking_price !== false && lead?.offer_amount && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1">Asking Price</p>
              <p className="text-xl font-bold text-white">{fmt(lead.offer_amount)}</p>
            </div>
          )}
        </div>

        {/* Property Details */}
        {details.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h2 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Property Details</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {details.map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[11px] text-white/40 font-medium">{label}</p>
                  <p className="text-sm font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photos */}
        {dealPage.photos && dealPage.photos.length > 0 && (
          <div>
            <h2 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Photos</h2>
            <div className="grid grid-cols-2 gap-3">
              {dealPage.photos.map((url: string, i: number) => (
                <img
                  key={i}
                  src={url}
                  alt={`Property photo ${i + 1}`}
                  className="rounded-xl border border-white/10 w-full object-cover aspect-video"
                />
              ))}
            </div>
          </div>
        )}

        {/* Offer CTA */}
        {dealPage.accept_offers && (
          <div className="bg-[#E32E2E]/10 border border-[#E32E2E]/30 rounded-xl p-6 text-center">
            <h2 className="text-lg font-bold mb-1">Interested in this property?</h2>
            <p className="text-sm text-white/60 mb-4">Submit your offer to get started.</p>
            <a
              href={`/api/deals/${slug}/offer`}
              className="inline-flex items-center gap-2 bg-[#E32E2E] text-white hover:bg-[#C42626] rounded-lg px-6 py-2.5 text-sm font-bold transition-colors"
            >
              Submit Offer
            </a>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pt-8 pb-4">
          <p className="text-[11px] text-white/30">
            Powered by Saving KC Homebuyers
          </p>
        </div>
      </main>
    </div>
  )
}
