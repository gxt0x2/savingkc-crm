import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function phoneLookupVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  const variants = new Set<string>()

  if (raw.trim()) variants.add(raw.trim())
  if (!digits) return Array.from(variants)

  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length === 10) {
    variants.add(`+1${national}`)
    variants.add(national)
    variants.add(`${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`)
    variants.add(`(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`)
  }

  return Array.from(variants)
}

export interface ProspectMatch {
  prospect_id: string
  parcel_id: string
  county: string
  situs_address: string | null
  situs_street: string | null
  situs_city: string | null
  situs_state: string | null
  situs_zip: string | null
  owner_1: string | null
  owner_1_first: string | null
  owner_1_last: string | null
  owner_1_type: string | null
  mailing_street: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  cumulative_due: number | null
  earliest_delinquent_year: number | null
  delinquent_years_category: string | null
  total_market_value: number | null
  zestimate: number | null
  occupancy_status: string | null
  is_deceased: boolean
  is_skip_traced: boolean
  owner_age: number | null
  email_1: string | null
  email_2: string | null
  lead_id: string | null
  // Phone match context
  phone_type: string | null
  contact_name: string | null
  relationship: string | null
}

type ProspectRow = {
  id: string
  parcel_id: string
  county: string
  situs_address: string | null
  situs_street: string | null
  situs_city: string | null
  situs_state: string | null
  situs_zip: string | null
  owner_1: string | null
  owner_1_first: string | null
  owner_1_last: string | null
  owner_1_type: string | null
  mailing_street: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  cumulative_due: number | null
  earliest_delinquent_year: number | null
  delinquent_years_category: string | null
  total_market_value: number | null
  zestimate: number | null
  occupancy_status: string | null
  is_deceased: boolean
  is_skip_traced: boolean
  owner_age: number | null
  email_1: string | null
  email_2: string | null
  lead_id: string | null
}

type ProspectPhoneRow = {
  phone_type: string | null
  contact_name: string | null
  relationship: string | null
  prospects: ProspectRow | ProspectRow[] | null
}

/**
 * Look up prospects by phone number across the known skip-trace phone table.
 * Returns all matching prospects sorted: owners first, 3yr+ before 2yr, highest debt first.
 */
export async function lookupProspectByPhone(phone: string): Promise<ProspectMatch[]> {
  const supabase = getSupabase()
  const variants = phoneLookupVariants(phone)
  if (variants.length === 0) return []

  const { data, error } = await supabase
    .from('prospect_phones')
    .select(`
      phone_type,
      contact_name,
      relationship,
      prospects (
        id,
        parcel_id,
        county,
        situs_address,
        situs_street,
        situs_city,
        situs_state,
        situs_zip,
        owner_1,
        owner_1_first,
        owner_1_last,
        owner_1_type,
        mailing_street,
        mailing_city,
        mailing_state,
        mailing_zip,
        cumulative_due,
        earliest_delinquent_year,
        delinquent_years_category,
        total_market_value,
        zestimate,
        occupancy_status,
        is_deceased,
        is_skip_traced,
        owner_age,
        email_1,
        email_2,
        lead_id
      )
    `)
    .in('phone', variants)

  if (error || !data) return []

  const matches: ProspectMatch[] = (data as ProspectPhoneRow[])
    .filter((row) => row.prospects)
    .map((row) => {
      const p = Array.isArray(row.prospects) ? row.prospects[0] : row.prospects
      if (!p) return null
      return {
        prospect_id: p.id,
        parcel_id: p.parcel_id,
        county: p.county,
        situs_address: p.situs_address,
        situs_street: p.situs_street,
        situs_city: p.situs_city,
        situs_state: p.situs_state,
        situs_zip: p.situs_zip,
        owner_1: p.owner_1,
        owner_1_first: p.owner_1_first,
        owner_1_last: p.owner_1_last,
        owner_1_type: p.owner_1_type,
        mailing_street: p.mailing_street,
        mailing_city: p.mailing_city,
        mailing_state: p.mailing_state,
        mailing_zip: p.mailing_zip,
        cumulative_due: p.cumulative_due,
        earliest_delinquent_year: p.earliest_delinquent_year,
        delinquent_years_category: p.delinquent_years_category,
        total_market_value: p.total_market_value,
        zestimate: p.zestimate,
        occupancy_status: p.occupancy_status,
        is_deceased: p.is_deceased,
        is_skip_traced: p.is_skip_traced,
        owner_age: p.owner_age,
        email_1: p.email_1,
        email_2: p.email_2,
        lead_id: p.lead_id,
        phone_type: row.phone_type,
        contact_name: row.contact_name,
        relationship: row.relationship,
      }
    })
    .filter((match): match is ProspectMatch => Boolean(match))

  // Sort: owners first, 3yr+ before 2yr, highest debt first
  matches.sort((a, b) => {
    // Owner phones before relative phones
    const aIsOwner = a.relationship === 'owner' ? 0 : 1
    const bIsOwner = b.relationship === 'owner' ? 0 : 1
    if (aIsOwner !== bIsOwner) return aIsOwner - bIsOwner

    // 3yr_plus before 2yr
    const aCategory = a.delinquent_years_category === '3yr_plus' ? 0 : 1
    const bCategory = b.delinquent_years_category === '3yr_plus' ? 0 : 1
    if (aCategory !== bCategory) return aCategory - bCategory

    // Highest debt first
    return (b.cumulative_due || 0) - (a.cumulative_due || 0)
  })

  return matches
}
