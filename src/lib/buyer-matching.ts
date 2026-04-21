/**
 * Buyer Matching Algorithm
 *
 * Scores buyers against a deal's property attributes to determine
 * the best-fit recipients for a broadcast.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'

interface BuyBox {
  zip_codes?: string[]
  cities?: string[]
  counties?: string[]
  property_types?: string[]
  price_min?: number
  price_max?: number
  beds_min?: number
  condition_ok?: string[]
  notes?: string
}

interface Buyer {
  id: string
  first_name: string
  last_name: string
  company_name?: string | null
  email?: string | null
  phone?: string | null
  tier: 'vip' | 'standard' | 'new'
  status: string
  buy_box?: BuyBox | null
  sms_opted_in: boolean
  email_opted_in: boolean
  deals_closed: number
  [key: string]: unknown
}

interface Lead {
  id: string
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  property_type?: string | null
  beds?: number | null
  baths_full?: number | null
  sqft?: number | null
  arv?: number | null
  offer_amount?: number | null
  [key: string]: unknown
}

export interface BuyerMatch {
  buyer_id: string
  buyer: Buyer
  score: number
  reasons: string[]
}

/**
 * Match active buyers to a deal/lead and return scored list
 */
export async function matchBuyersToDeal(leadId: string): Promise<BuyerMatch[]> {
  const db = supabaseAdmin()

  // 1. Fetch the lead
  const { data: lead, error: leadError } = await db
    .from('leads')
    .select('id, property_address, city, state, zip, county, property_type, beds, baths_full, sqft, arv, offer_amount')
    .eq('id', leadId)
    .single()

  if (leadError || !lead) {
    throw new Error(`Lead not found: ${leadId}`)
  }

  // 2. Fetch all active buyers
  const { data: buyers, error: buyersError } = await db
    .from('buyers')
    .select('*')
    .eq('status', 'active')

  if (buyersError) {
    throw new Error(`Failed to fetch buyers: ${buyersError.message}`)
  }

  if (!buyers || buyers.length === 0) {
    return []
  }

  // 3. Score each buyer
  const matches: BuyerMatch[] = []

  for (const buyer of buyers as Buyer[]) {
    const { score, reasons } = scoreBuyer(lead as Lead, buyer)

    // 4. Filter: minimum score 15, must have at least one contact method opted-in
    if (score < 15) continue
    if (!buyer.sms_opted_in && !buyer.email_opted_in) continue

    matches.push({
      buyer_id: buyer.id,
      buyer,
      score,
      reasons,
    })
  }

  // 5. Sort by score descending
  matches.sort((a, b) => b.score - a.score)

  return matches
}

function scoreBuyer(lead: Lead, buyer: Buyer): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const buyBox = buyer.buy_box

  if (!buyBox) {
    // No buy box defined - only tier/deals bonuses apply
    if (buyer.tier === 'vip') {
      score += 10
      reasons.push('VIP tier')
    }
    if ((buyer.deals_closed ?? 0) > 0) {
      score += 5
      reasons.push(`${buyer.deals_closed} deals closed`)
    }
    return { score, reasons }
  }

  // ZIP match: +40
  if (
    lead.zip &&
    buyBox.zip_codes &&
    buyBox.zip_codes.length > 0 &&
    buyBox.zip_codes.includes(lead.zip)
  ) {
    score += 40
    reasons.push(`ZIP ${lead.zip} match`)
  }

  // City match: +20 (case-insensitive)
  if (
    lead.city &&
    buyBox.cities &&
    buyBox.cities.length > 0 &&
    buyBox.cities.some(c => c.toLowerCase() === lead.city!.toLowerCase())
  ) {
    score += 20
    reasons.push(`City ${lead.city} match`)
  }

  // County match: +15
  if (
    lead.county &&
    buyBox.counties &&
    buyBox.counties.length > 0 &&
    buyBox.counties.some(c => c.toLowerCase() === lead.county!.toLowerCase())
  ) {
    score += 15
    reasons.push(`County ${lead.county} match`)
  }

  // Price in range: +15
  const priceRef = lead.arv ?? lead.offer_amount
  if (priceRef != null) {
    const min = buyBox.price_min ?? 0
    const max = buyBox.price_max ?? Infinity
    if (priceRef >= min && priceRef <= max) {
      score += 15
      reasons.push(`Price $${priceRef.toLocaleString()} in range`)
    }
  }

  // Property type match: +10
  if (
    lead.property_type &&
    buyBox.property_types &&
    buyBox.property_types.length > 0 &&
    buyBox.property_types.some(
      pt => pt.toLowerCase() === lead.property_type!.toLowerCase()
    )
  ) {
    score += 10
    reasons.push(`Type ${lead.property_type} match`)
  }

  // VIP tier bonus: +10
  if (buyer.tier === 'vip') {
    score += 10
    reasons.push('VIP tier')
  }

  // Has closed deals with us: +5
  if ((buyer.deals_closed ?? 0) > 0) {
    score += 5
    reasons.push(`${buyer.deals_closed} deals closed`)
  }

  return { score, reasons }
}
