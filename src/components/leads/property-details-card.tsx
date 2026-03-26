// LED-05 + LED-06: Housing Detail Card with 18 Data Points
// Night 4 Phase 1: Complete Property Dossier

import { Icon } from '@/components/ui/icon'

export interface PropertyHousingDetails {
  // Core specs
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  lot_size: number | null // in square feet
  year_built: number | null

  // Structure details
  basement_type: string | null
  stories: number | null
  garage_spaces: number | null
  roof_type: string | null
  heating: string | null
  cooling: string | null

  // Property classification
  property_type: string | null
  zoning: string | null

  // Financial
  hoa_amount: number | null
  tax_assessment: number | null
  last_sale_date: string | null
  last_sale_price: number | null

  // Metadata
  data_source: string | null
  data_enriched_at: string | null
}

interface PropertyDetailsCardProps {
  details: PropertyHousingDetails
  address?: string
  onEdit?: () => void
}

function formatLotSize(sqft: number | null): string {
  if (!sqft) return '—'
  const acres = sqft / 43560
  if (acres >= 0.1) {
    return `${acres.toFixed(2)} AC`
  }
  return `${sqft.toLocaleString()} SF`
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '—'
  return `$${amount.toLocaleString()}`
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getDataSourceBadge(source: string | null): { label: string; color: string } {
  if (!source) return { label: 'Not Enriched', color: 'bg-gray-100 text-gray-600' }

  switch (source.toLowerCase()) {
    case 'county':
      return { label: 'County', color: 'bg-blue-100 text-blue-700' }
    case 'zillow':
      return { label: 'Zillow', color: 'bg-purple-100 text-purple-700' }
    case 'usfirstcheck':
      return { label: 'US First Check', color: 'bg-green-100 text-green-700' }
    case 'manual':
      return { label: 'Manual', color: 'bg-amber-100 text-amber-700' }
    default:
      return { label: source, color: 'bg-slate-100 text-slate-600' }
  }
}

export function PropertyDetailsCard({ details, address, onEdit }: PropertyDetailsCardProps) {
  const sourceBadge = getDataSourceBadge(details.data_source)

  // Calculate completeness
  const totalFields = 18
  const filledFields = [
    details.beds,
    details.baths_full,
    details.baths_half,
    details.sqft,
    details.lot_size,
    details.year_built,
    details.basement_type,
    details.stories,
    details.garage_spaces,
    details.roof_type,
    details.heating,
    details.cooling,
    details.property_type,
    details.zoning,
    details.hoa_amount !== null ? 0 : null, // HOA can be $0
    details.tax_assessment,
    details.last_sale_date,
    details.last_sale_price,
  ].filter(v => v !== null && v !== undefined).length

  const completenessPercent = Math.round((filledFields / totalFields) * 100)
  const isIncomplete = completenessPercent < 50

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary">
            Property Details
          </h2>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${sourceBadge.color}`}>
            {sourceBadge.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-surface-container rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isIncomplete ? 'bg-amber-500' : 'bg-green-500'
                }`}
                style={{ width: `${completenessPercent}%` }}
              />
            </div>
            <span className={`text-[11px] font-bold ${isIncomplete ? 'text-amber-600' : 'text-green-600'}`}>
              {filledFields}/{totalFields}
            </span>
          </div>
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-primary hover:text-secondary transition-colors"
              title="Edit property details"
            >
              <Icon name="edit" size="text-lg" />
            </button>
          )}
        </div>
      </div>

      {/* Data Quality Alert */}
      {isIncomplete && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
          <Icon name="warning" className="text-amber-600 !text-sm shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-1">
              Incomplete Property Data
            </p>
            <p className="text-xs text-amber-700">
              {totalFields - filledFields} of {totalFields} fields missing. Complete data improves deal accuracy.
            </p>
          </div>
        </div>
      )}

      {/* 3-Column Grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Core Specs */}
        <DetailItem icon="bed" label="Bedrooms" value={details.beds?.toString()} />
        <DetailItem
          icon="bathtub"
          label="Bathrooms"
          value={
            details.baths_full || details.baths_half
              ? `${details.baths_full || 0} / ${details.baths_half || 0}`
              : null
          }
          subtitle={details.baths_full || details.baths_half ? 'Full / Half' : undefined}
        />
        <DetailItem
          icon="square_foot"
          label="Square Footage"
          value={details.sqft ? details.sqft.toLocaleString() : null}
          unit="SF"
        />

        <DetailItem
          icon="landscape"
          label="Lot Size"
          value={details.lot_size ? formatLotSize(details.lot_size) : null}
        />
        <DetailItem
          icon="calendar_today"
          label="Year Built"
          value={details.year_built?.toString()}
        />
        <DetailItem
          icon="layers"
          label="Stories"
          value={details.stories?.toString()}
        />

        {/* Structure Details */}
        <DetailItem
          icon="foundation"
          label="Basement"
          value={details.basement_type || null}
        />
        <DetailItem
          icon="garage"
          label="Garage"
          value={details.garage_spaces ? `${details.garage_spaces} spaces` : null}
        />
        <DetailItem
          icon="roofing"
          label="Roof Type"
          value={details.roof_type || null}
        />

        <DetailItem
          icon="whatshot"
          label="Heating"
          value={details.heating || null}
        />
        <DetailItem
          icon="ac_unit"
          label="Cooling"
          value={details.cooling || null}
        />
        <DetailItem
          icon="home"
          label="Property Type"
          value={details.property_type || null}
        />

        {/* Classification & Financial */}
        <DetailItem
          icon="map"
          label="Zoning"
          value={details.zoning || null}
        />
        <DetailItem
          icon="account_balance"
          label="HOA"
          value={
            details.hoa_amount !== null && details.hoa_amount !== undefined
              ? details.hoa_amount === 0
                ? 'None'
                : formatCurrency(details.hoa_amount)
              : null
          }
          subtitle={details.hoa_amount && details.hoa_amount > 0 ? 'per month' : undefined}
        />
        <DetailItem
          icon="assessment"
          label="Tax Assessment"
          value={details.tax_assessment ? formatCurrency(details.tax_assessment) : null}
        />

        <DetailItem
          icon="event"
          label="Last Sale Date"
          value={formatDate(details.last_sale_date)}
        />
        <DetailItem
          icon="attach_money"
          label="Last Sale Price"
          value={details.last_sale_price ? formatCurrency(details.last_sale_price) : null}
        />
      </div>

      {/* Data Source Footer */}
      {details.data_enriched_at && (
        <div className="mt-5 pt-4 border-t border-outline-variant/20">
          <p className="text-[10px] text-on-surface-variant">
            Last enriched: {formatDate(details.data_enriched_at)}
          </p>
        </div>
      )}
    </section>
  )
}

function DetailItem({
  icon,
  label,
  value,
  unit,
  subtitle,
}: {
  icon: string
  label: string
  value: string | null | undefined
  unit?: string
  subtitle?: string
}) {
  const isEmpty = !value || value === '—'

  return (
    <div className={`p-3 rounded-lg ${isEmpty ? 'bg-surface-container/30' : 'bg-surface-container-low'}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon
          name={icon}
          className={`!text-sm ${isEmpty ? 'text-on-surface-variant/40' : 'text-primary'}`}
        />
        <p className={`text-[10px] font-bold uppercase ${isEmpty ? 'text-on-surface-variant/60' : 'text-on-surface-variant'}`}>
          {label}
        </p>
      </div>
      <p className={`text-sm font-black ${isEmpty ? 'text-on-surface-variant/40' : 'text-primary'}`}>
        {value || '—'}
        {unit && value && value !== '—' && (
          <span className="text-[10px] font-medium opacity-60 ml-1">{unit}</span>
        )}
      </p>
      {subtitle && (
        <p className="text-[9px] text-on-surface-variant/60 mt-0.5">{subtitle}</p>
      )}
    </div>
  )
}
