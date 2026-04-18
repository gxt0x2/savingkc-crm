'use client'

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
  tax_owed: number | null
  last_sale_date: string | null
  last_sale_price: number | null

  // Metadata
  data_source: string | null
  data_enriched_at: string | null
}

interface PropertyDetailsCardProps {
  details: PropertyHousingDetails
  address?: string
  city?: string
  state?: string
  zip?: string
  leadId?: string
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

function getDataSourceBadge(source: string | null): { label: string } {
  if (!source) return { label: 'Not Enriched' }
  switch (source.toLowerCase()) {
    case 'county': return { label: 'County' }
    case 'zillow': return { label: 'Zillow' }
    case 'usfirstcheck': return { label: 'US First Check' }
    case 'manual': return { label: 'Manual' }
    case 'johnson_county_assessor': return { label: 'Johnson Co.' }
    case 'jackson_county_assessor': return { label: 'Jackson Co.' }
    case 'clay_county_assessor': return { label: 'Clay Co.' }
    case 'wyandotte_county_assessor': return { label: 'Wyandotte Co.' }
    default: return { label: source }
  }
}

export function PropertyDetailsCard({ details, onEdit }: PropertyDetailsCardProps) {
  const sourceBadge = getDataSourceBadge(details.data_source)

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="home_work" className="!text-base !text-[color:var(--ck-accent)]" />
          <h2 className="ck-microlabel !text-[11px] !text-white">Property Details</h2>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{
              background: 'var(--ck-surface-elev)',
              border: '1px solid var(--ck-border)',
              color: 'var(--ck-text-muted)',
            }}
          >
            {sourceBadge.label}
          </span>
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-[color:var(--ck-text-dim)] hover:text-white transition-colors"
            title="Edit property details"
          >
            <Icon name="edit" size="text-sm" />
          </button>
        )}
      </div>

      {/* ── Specs grid ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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

        <DetailItem
          icon="map"
          label="Zoning"
          value={details.zoning || null}
        />
      </div>

      {/* ── Tax & Finance — visually distinct from the spec grid ──────── */}
      {(
        details.tax_assessment ||
        details.tax_owed ||
        details.hoa_amount !== null ||
        details.last_sale_date ||
        details.last_sale_price
      ) && (
        <div
          className="mt-4 rounded-xl p-3 border"
          style={{
            background:
              'linear-gradient(180deg, rgba(239,68,68,0.05) 0%, rgba(239,68,68,0.02) 100%)',
            borderColor: 'rgba(239,68,68,0.2)',
          }}
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Icon name="account_balance_wallet" className="!text-sm !text-[color:var(--ck-accent)]" />
            <p className="ck-microlabel !text-[10px]" style={{ color: 'var(--ck-accent-bright)' }}>
              Tax &amp; Finance
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <FinanceItem
              icon="warning_amber"
              label="Taxes Owed"
              value={details.tax_owed ? formatCurrency(details.tax_owed) : null}
              tone="danger"
            />
            <FinanceItem
              icon="assessment"
              label="Tax Assessment"
              value={details.tax_assessment ? formatCurrency(details.tax_assessment) : null}
              tone="neutral"
            />
            <FinanceItem
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
              tone="neutral"
            />
            <FinanceItem
              icon="event"
              label="Last Sale Date"
              value={formatDate(details.last_sale_date)}
              tone="neutral"
            />
            <FinanceItem
              icon="attach_money"
              label="Last Sale Price"
              value={details.last_sale_price ? formatCurrency(details.last_sale_price) : null}
              tone="neutral"
            />
          </div>
        </div>
      )}

      {/* Data Source Footer */}
      {details.data_enriched_at && (
        <p
          className="mt-3 text-[10px]"
          style={{ color: 'var(--ck-text-muted)' }}
        >
          Last enriched: {formatDate(details.data_enriched_at)}
        </p>
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
  // Hide empty cells entirely — user wants clean display
  if (!value || value === '—') return null

  return (
    <div
      className="p-2.5 rounded-lg border"
      style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon name={icon} className="!text-xs !text-[color:var(--ck-accent)]" />
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ck-text-muted)' }}>
          {label}
        </p>
      </div>
      <p className="text-sm font-black" style={{ color: 'var(--ck-text)' }}>
        {value}
        {unit && (
          <span className="text-[10px] font-medium opacity-60 ml-1">{unit}</span>
        )}
      </p>
      {subtitle && (
        <p className="text-[9px] mt-0.5" style={{ color: 'var(--ck-text-dim)' }}>{subtitle}</p>
      )}
    </div>
  )
}

/**
 * Finance-specific tile. Visually distinct from DetailItem:
 *  - darker translucent surface over the red-tinted finance container
 *  - value in red for `danger` tone (taxes owed), white for neutral
 */
function FinanceItem({
  icon,
  label,
  value,
  subtitle,
  tone = 'neutral',
}: {
  icon: string
  label: string
  value: string | null | undefined
  subtitle?: string
  tone?: 'neutral' | 'danger'
}) {
  if (!value || value === '—') return null

  const danger = tone === 'danger'

  return (
    <div
      className="p-2.5 rounded-lg border"
      style={{
        background: 'rgba(0,0,0,0.35)',
        borderColor: danger ? 'rgba(239,68,68,0.35)' : 'var(--ck-border)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon
          name={icon}
          className={`!text-xs ${danger ? '!text-[color:var(--ck-accent-bright)]' : '!text-[color:var(--ck-text-muted)]'}`}
        />
        <p
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: danger ? 'var(--ck-accent-bright)' : 'var(--ck-text-muted)' }}
        >
          {label}
        </p>
      </div>
      <p
        className="text-sm font-black"
        style={{ color: danger ? 'var(--ck-accent-bright)' : 'var(--ck-text)' }}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-[9px] mt-0.5" style={{ color: 'var(--ck-text-dim)' }}>{subtitle}</p>
      )}
    </div>
  )
}
