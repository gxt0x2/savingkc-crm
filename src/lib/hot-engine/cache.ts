/**
 * Hot Opportunities Cache Manager
 *
 * - surgicalRescore(leadId, triggerEvent) — rescore one lead + re-rank top 7
 * - fullRerank() — score all active leads, bulk upsert, assign ranks 1-7
 * - getHotList() — read top 7 from cache, join with manifest data for card rendering
 */

import { createClient } from '@supabase/supabase-js'
import { scoreOpportunity } from './scoring'
import { generateHotSignal, isSignalStale } from './ari-signal'
import type { ManifestV2 } from '../manifest-builder'
import type { HotOpportunityData } from '@/types/hot-opportunity'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const DEAD_STATIONS = ['dead', 'closed', 'disposition']
const HOT_LIST_SIZE = 7

interface CacheRow {
  id: string
  lead_id: string
  composite_score: number
  engagement_score: number
  velocity_score: number
  deal_quality_score: number
  time_pressure_score: number
  multiplier: number
  tier_label: string
  tier_capped: boolean
  rank: number | null
  on_hot_list: boolean
  raw_inputs: any
  promoted_at: string | null
  demoted_at: string | null
  cooldown_until: string | null
  last_scored_at: string
  last_trigger_event: string | null
}

// ─── Surgical Rescore ────────────────────────────────────────────────────────

export async function surgicalRescore(
  leadId: string,
  triggerEvent: string,
  isTier1?: boolean,
): Promise<void> {
  const supabase = getSupabase()

  // Fetch manifest
  const { data: manifestRow } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .eq('lead_id', leadId)
    .limit(1)
    .single()

  if (!manifestRow?.manifest) return

  const manifest = manifestRow.manifest as ManifestV2

  // Also fetch leads table data to hydrate empty manifest fields
  const { data: leadRow } = await supabase
    .from('leads')
    .select('arv, offer_amount, repair_estimate, motivation_score, priority, station, source, phone, created_at, is_favorite, updated_at')
    .eq('id', leadId)
    .single()

  // Hydrate manifest from leads table if fields are empty
  if (leadRow && manifest) {
    if (!manifest.financials) manifest.financials = {} as any
    if (!manifest.financials!.arv && leadRow.arv) manifest.financials!.arv = leadRow.arv
    if (!manifest.financials!.offer_amount && leadRow.offer_amount) manifest.financials!.offer_amount = leadRow.offer_amount
    if (!manifest.financials!.repair_estimate && leadRow.repair_estimate) manifest.financials!.repair_estimate = leadRow.repair_estimate
    if (!manifest.situation) manifest.situation = { type: [] } as any
    if (!manifest.situation!.motivation) manifest.situation!.motivation = {} as any
    if (!manifest.situation!.motivation!.score && leadRow.motivation_score) manifest.situation!.motivation!.score = leadRow.motivation_score
    if (!manifest.leadSource && leadRow.source) manifest.leadSource = leadRow.source
    if (!manifest.leadCreatedDate && leadRow.created_at) manifest.leadCreatedDate = leadRow.created_at
    if (!manifest.owner) manifest.owner = {} as any
    if (!manifest.owner!.phones?.length && leadRow.phone) manifest.owner!.phones = [leadRow.phone]
    // Use leads table station if manifest station is wrong
    if (leadRow.station && leadRow.station !== manifest.currentStation) manifest.currentStation = leadRow.station
    // Carry priority + favorite onto manifest for scoring bonus
    if (leadRow.priority) (manifest as any).priority = leadRow.priority
    if (leadRow.is_favorite) (manifest as any).is_favorite = true
  }

  // Hydrate engagement from lead_activities if manifest has no contact data
  if (!manifest.communications?.lastSellerContactDate && !manifest.communications?.lastInboundDate) {
    const { data: lastActivity } = await supabase
      .from('lead_activities')
      .select('created_at, activity_type, metadata')
      .eq('lead_id', leadId)
      .in('activity_type', ['call', 'sms', 'voicemail'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (lastActivity?.created_at) {
      if (!manifest.communications) manifest.communications = { transcripts: [] } as any
      manifest.communications!.lastSellerContactDate = lastActivity.created_at
      // Check if seller-initiated (inbound)
      const meta = lastActivity.metadata || {}
      if (meta.direction === 'inbound' || meta.direction === 'in') {
        manifest.communications!.lastInboundDate = lastActivity.created_at
        manifest.communications!.totalInboundContacts = (manifest.communications!.totalInboundContacts || 0) + 1
      }
    }
  }

  // Skip dead/closed leads
  if (DEAD_STATIONS.includes(manifest.currentStation)) return

  // Score
  const result = scoreOpportunity(manifest)

  const now = new Date().toISOString()

  // Upsert cache
  const cacheData = {
    lead_id: leadId,
    composite_score: result.composite,
    engagement_score: result.factors.engagement,
    velocity_score: result.factors.velocity,
    deal_quality_score: result.factors.dealQuality,
    time_pressure_score: result.factors.timePressure,
    multiplier: result.multiplier,
    tier_label: result.tierLabel,
    tier_capped: result.tierCapped,
    raw_inputs: result.rawInputs,
    last_scored_at: now,
    last_trigger_event: triggerEvent,
    updated_at: now,
  }

  const { data: existing } = await supabase
    .from('hot_opportunities_cache')
    .select('id, on_hot_list, cooldown_until')
    .eq('lead_id', leadId)
    .limit(1)
    .single()

  if (existing) {
    await supabase
      .from('hot_opportunities_cache')
      .update(cacheData)
      .eq('id', existing.id)
  } else {
    await supabase
      .from('hot_opportunities_cache')
      .insert(cacheData)
  }

  // Audit trail
  await supabase.from('hot_score_audit_trail').insert({
    lead_id: leadId,
    composite_score: result.composite,
    engagement_score: result.factors.engagement,
    velocity_score: result.factors.velocity,
    deal_quality_score: result.factors.dealQuality,
    time_pressure_score: result.factors.timePressure,
    multiplier: result.multiplier,
    tier_label: result.tierLabel,
    tier_capped: result.tierCapped,
    trigger_event: triggerEvent,
    raw_inputs: result.rawInputs,
  })

  // Re-rank top 7 + refresh Ari signals
  await rerankTopN(isTier1)
  refreshAriSignalsForHotList().catch(err => console.error('[hot-engine] Signal refresh failed:', err))
}

// ─── Full Re-rank ────────────────────────────────────────────────────────────

export async function fullRerank(): Promise<{ scored: number; hotList: number }> {
  const supabase = getSupabase()

  // Fetch all active leads with manifests
  const { data: rows } = await supabase
    .from('manifests')
    .select('lead_id, manifest')
    .not('current_station', 'in', `(${DEAD_STATIONS.join(',')})`)

  if (!rows || rows.length === 0) return { scored: 0, hotList: 0 }

  const now = new Date().toISOString()
  let scored = 0

  // Fetch all leads table data for hydration (batch query)
  const allLeadIds = rows.map(r => r.lead_id).filter(Boolean) as string[]
  const { data: allLeadRows } = await supabase
    .from('leads')
    .select('id, arv, offer_amount, repair_estimate, motivation_score, priority, station, source, phone, created_at, is_favorite, updated_at')
    .in('id', allLeadIds)

  const leadRowMap = new Map<string, any>()
  for (const lr of allLeadRows || []) {
    leadRowMap.set(lr.id, lr)
  }

  // Batch fetch last activity per lead for engagement hydration
  // Use a single query: get recent call/sms/voicemail per lead
  const { data: lastActivities } = await supabase
    .from('lead_activities')
    .select('lead_id, created_at, activity_type, metadata')
    .in('lead_id', allLeadIds)
    .in('activity_type', ['call', 'sms', 'voicemail'])
    .order('created_at', { ascending: false })

  // Build map: lead_id → most recent activity
  const lastActivityMap = new Map<string, any>()
  for (const act of lastActivities || []) {
    if (!lastActivityMap.has(act.lead_id)) {
      lastActivityMap.set(act.lead_id, act)
    }
  }

  for (const row of rows) {
    if (!row.manifest || !row.lead_id) continue
    const manifest = row.manifest as ManifestV2

    // Hydrate manifest from leads table if fields are empty
    const leadRow = leadRowMap.get(row.lead_id)
    if (leadRow) {
      if (!manifest.financials) manifest.financials = {} as any
      if (!manifest.financials!.arv && leadRow.arv) manifest.financials!.arv = leadRow.arv
      if (!manifest.financials!.offer_amount && leadRow.offer_amount) manifest.financials!.offer_amount = leadRow.offer_amount
      if (!manifest.financials!.repair_estimate && leadRow.repair_estimate) manifest.financials!.repair_estimate = leadRow.repair_estimate
      if (!manifest.situation) manifest.situation = { type: [] } as any
      if (!manifest.situation!.motivation) manifest.situation!.motivation = {} as any
      if (!manifest.situation!.motivation!.score && leadRow.motivation_score) manifest.situation!.motivation!.score = leadRow.motivation_score
      if (!manifest.leadSource && leadRow.source) manifest.leadSource = leadRow.source
      if (!manifest.leadCreatedDate && leadRow.created_at) manifest.leadCreatedDate = leadRow.created_at
      if (!manifest.owner) manifest.owner = {} as any
      if (!manifest.owner!.phones?.length && leadRow.phone) manifest.owner!.phones = [leadRow.phone]
      // Use leads table station if manifest station is wrong
      if (leadRow.station && leadRow.station !== manifest.currentStation) manifest.currentStation = leadRow.station
      // Carry priority + favorite onto manifest for scoring bonus
      if (leadRow.priority) (manifest as any).priority = leadRow.priority
      if (leadRow.is_favorite) (manifest as any).is_favorite = true
    }

    // Hydrate engagement from lead_activities if manifest has no contact data
    if (!manifest.communications?.lastSellerContactDate && !manifest.communications?.lastInboundDate) {
      const lastAct = lastActivityMap.get(row.lead_id)
      if (lastAct?.created_at) {
        if (!manifest.communications) manifest.communications = { transcripts: [] } as any
        manifest.communications!.lastSellerContactDate = lastAct.created_at
        const meta = lastAct.metadata || {}
        if (meta.direction === 'inbound' || meta.direction === 'in') {
          manifest.communications!.lastInboundDate = lastAct.created_at
          manifest.communications!.totalInboundContacts = 1
        }
      }
    }

    const result = scoreOpportunity(manifest)

    // Upsert cache
    const { data: existing } = await supabase
      .from('hot_opportunities_cache')
      .select('id')
      .eq('lead_id', row.lead_id)
      .limit(1)
      .single()

    const cacheData = {
      lead_id: row.lead_id,
      composite_score: result.composite,
      engagement_score: result.factors.engagement,
      velocity_score: result.factors.velocity,
      deal_quality_score: result.factors.dealQuality,
      time_pressure_score: result.factors.timePressure,
      multiplier: result.multiplier,
      tier_label: result.tierLabel,
      tier_capped: result.tierCapped,
      raw_inputs: result.rawInputs,
      last_scored_at: now,
      last_trigger_event: 'full_rerank',
      updated_at: now,
    }

    if (existing) {
      await supabase.from('hot_opportunities_cache').update(cacheData).eq('id', existing.id)
    } else {
      await supabase.from('hot_opportunities_cache').insert(cacheData)
    }

    // Audit trail
    await supabase.from('hot_score_audit_trail').insert({
      lead_id: row.lead_id,
      composite_score: result.composite,
      engagement_score: result.factors.engagement,
      velocity_score: result.factors.velocity,
      deal_quality_score: result.factors.dealQuality,
      time_pressure_score: result.factors.timePressure,
      multiplier: result.multiplier,
      tier_label: result.tierLabel,
      tier_capped: result.tierCapped,
      trigger_event: 'full_rerank',
      raw_inputs: result.rawInputs,
    })

    scored++
  }

  // Assign ranks + generate Ari signals for top 7
  const hotCount = await rerankTopN()
  await refreshAriSignalsForHotList()
  return { scored, hotList: hotCount }
}

// ─── Re-rank Top N ───────────────────────────────────────────────────────────

async function rerankTopN(overrideCooldown?: boolean): Promise<number> {
  const supabase = getSupabase()
  const now = new Date()

  // Get all cache entries sorted by score
  const { data: allCache } = await supabase
    .from('hot_opportunities_cache')
    .select('*')
    .order('composite_score', { ascending: false })

  if (!allCache) return 0

  // Clear existing hot list
  await supabase
    .from('hot_opportunities_cache')
    .update({ rank: null, on_hot_list: false })
    .eq('on_hot_list', true)

  // Apply cooldown and quality gates
  const eligible = allCache.filter((row: CacheRow) => {
    // Must have score >= 33 (meaningful data threshold)
    if (row.composite_score < 33) return false

    // Quality gate: intake leads need SOME signal of value to be on hot list
    // Favorited, warm/hot priority, or financials all qualify
    const ri = row.raw_inputs || {}
    const station = ri.velocity?.currentStation || ''
    const hasFinancials = ri.dealQuality?.arv || ri.dealQuality?.spread
    const hasUserSignal = ri.isFavorite || ri.priorityHot || ri.priorityWarm
    if (['intake', 'new'].includes(station) && !hasFinancials && !hasUserSignal) return false

    // Check cooldown (favorites override cooldown — user starred means they want to see it)
    if (!overrideCooldown && !ri.isFavorite && row.cooldown_until) {
      const cooldownEnd = new Date(row.cooldown_until)
      if (cooldownEnd > now) return false
    }

    return true
  })

  // Assign ranks 1-7
  const topN = eligible.slice(0, HOT_LIST_SIZE)
  for (let i = 0; i < topN.length; i++) {
    const entry = topN[i] as CacheRow
    const wasOnList = entry.on_hot_list
    const isPromoting = !wasOnList

    const update: Record<string, any> = {
      rank: i + 1,
      on_hot_list: true,
      updated_at: now.toISOString(),
    }
    if (isPromoting) {
      update.promoted_at = now.toISOString()
    }

    await supabase
      .from('hot_opportunities_cache')
      .update(update)
      .eq('id', entry.id)

    // Update audit trail with position
    await supabase
      .from('hot_score_audit_trail')
      .update({ on_hot_list: true, list_position: i + 1 })
      .eq('lead_id', entry.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
  }

  // Apply cooldown to leads that were on the list but aren't anymore
  const topNIds = new Set(topN.map((e: CacheRow) => e.lead_id))
  const demoted = allCache.filter(
    (row: CacheRow) => row.on_hot_list && !topNIds.has(row.lead_id)
  )
  for (const entry of demoted) {
    await supabase
      .from('hot_opportunities_cache')
      .update({
        demoted_at: now.toISOString(),
        cooldown_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', (entry as CacheRow).id)
  }

  return topN.length
}

// ─── Ari Signal Refresh ──────────────────────────────────────────────────────

async function refreshAriSignalsForHotList(): Promise<void> {
  const supabase = getSupabase()

  // Get top 7 leads
  const { data: hotCache } = await supabase
    .from('hot_opportunities_cache')
    .select('lead_id')
    .eq('on_hot_list', true)
    .order('rank', { ascending: true })

  if (!hotCache || hotCache.length === 0) return

  const leadIds = hotCache.map((r: any) => r.lead_id)

  // Fetch manifests
  const { data: manifestRows } = await supabase
    .from('manifests')
    .select('id, lead_id, manifest')
    .in('lead_id', leadIds)

  if (!manifestRows) return

  for (const row of manifestRows) {
    const manifest = row.manifest as ManifestV2
    if (!manifest) continue

    // Only regenerate if signal is stale or missing
    if (!isSignalStale(manifest)) continue

    // Score for context
    const score = scoreOpportunity(manifest)

    // Generate signal (fire-and-forget per lead)
    generateHotSignal(manifest, score)
      .then(async (result) => {
        // Update manifest with signal
        if (!manifest.ariIntelligence) manifest.ariIntelligence = {} as any
        manifest.ariIntelligence!.hotSignal = result.signal
        manifest.ariIntelligence!.hotNextMove = result.nextMove
        manifest.ariIntelligence!.hotSignalGeneratedAt = new Date().toISOString()

        await supabase
          .from('manifests')
          .update({ manifest, updated_at: new Date().toISOString() })
          .eq('id', row.id)
      })
      .catch(err => console.error(`[ari-signal] Failed for lead ${row.lead_id}:`, err))
  }
}

// ─── Get Hot List ────────────────────────────────────────────────────────────

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function formatRelativeDate(dateStr?: string | null): string | undefined {
  if (!dateStr) return undefined
  const days = daysSince(dateStr)
  if (days === null) return undefined
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function cadenceHealth(lastDate?: string | null): 'green' | 'amber' | 'red' | 'gray' {
  if (!lastDate) return 'gray'
  const days = daysSince(lastDate)
  if (days === null) return 'gray'
  if (days <= 3) return 'green'
  if (days <= 7) return 'amber'
  return 'red'
}

export async function getHotList(): Promise<{
  items: HotOpportunityData[]
  lastRankedAt: string | null
}> {
  const supabase = getSupabase()

  // Fetch cached hot list
  const { data: cacheRows } = await supabase
    .from('hot_opportunities_cache')
    .select('*')
    .eq('on_hot_list', true)
    .order('rank', { ascending: true })

  if (!cacheRows || cacheRows.length === 0) {
    return { items: [], lastRankedAt: null }
  }

  // Fetch manifests for hot leads
  const leadIds = cacheRows.map((r: any) => r.lead_id)
  const { data: manifestRows } = await supabase
    .from('manifests')
    .select('lead_id, manifest')
    .in('lead_id', leadIds)

  const manifestMap = new Map<string, ManifestV2>()
  for (const row of manifestRows || []) {
    if (row.manifest) manifestMap.set(row.lead_id, row.manifest as ManifestV2)
  }

  // Also fetch lead data from leads table (including financials for hydration)
  const { data: leadRows } = await supabase
    .from('leads')
    .select('id, source, county, city, created_at, phone, arv, offer_amount, repair_estimate, motivation_score, priority, station, full_name, property_address')
    .in('id', leadIds)

  const leadMap = new Map<string, any>()
  for (const row of leadRows || []) {
    leadMap.set(row.id, row)
  }

  // Build card data
  const items: HotOpportunityData[] = cacheRows.map((cache: any) => {
    const m = manifestMap.get(cache.lead_id)
    const lead = leadMap.get(cache.lead_id)

    // Hydrate manifest financials from leads table (same as scoring does)
    if (m && lead) {
      if (!m.financials) m.financials = {} as any
      if (!m.financials!.arv && lead.arv) m.financials!.arv = lead.arv
      if (!m.financials!.offer_amount && lead.offer_amount) m.financials!.offer_amount = lead.offer_amount
      if (!m.financials!.repair_estimate && lead.repair_estimate) m.financials!.repair_estimate = lead.repair_estimate
      if (!m.owner) m.owner = {} as any
      if (!m.owner.fullName && lead.full_name) m.owner.fullName = lead.full_name
      if (!m.owner.phones?.length && lead.phone) m.owner.phones = [lead.phone]
      if (!m.property?.address && lead.property_address) {
        if (!m.property) m.property = {} as any
        m.property.address = lead.property_address
      }
      if (lead.station && !m.currentStation) m.currentStation = lead.station
    }

    const timeline = m?.situation?.timeline
    const financials = m?.financials

    // Compute spread
    const spread = financials?.spread ?? (
      financials?.arv && financials?.offer_amount
        ? financials.arv - financials.offer_amount - (financials.repair_estimate || 0)
        : undefined
    )

    // Missing fields for data completeness warning
    const missing: string[] = []
    if (!financials?.arv) missing.push('ARV')
    if (!financials?.repair_estimate) missing.push('Repair Estimate')
    if (!financials?.offer_amount) missing.push('Offer Amount')
    if (!m?.communications?.transcripts?.some(t => t.extractedData?.motivationScore !== undefined)) {
      missing.push('Call Analysis')
    }

    // Cadence health
    const ch = {
      call: cadenceHealth(m?.lastCallDate),
      text: cadenceHealth(m?.lastTextDate),
      email: cadenceHealth(m?.lastEmailDate),
      mail: cadenceHealth(m?.lastMailDate),
    }

    // Lead age
    const createdDate = m?.leadCreatedDate || lead?.created_at
    const leadAgeDays = daysSince(createdDate)
    const leadAge = leadAgeDays !== null
      ? (leadAgeDays < 7 ? `${leadAgeDays}d` : leadAgeDays < 30 ? `${Math.floor(leadAgeDays / 7)}w` : `${Math.floor(leadAgeDays / 30)}mo`)
      : undefined

    return {
      leadId: cache.lead_id,
      rank: cache.rank,
      score: {
        engagement: cache.engagement_score,
        velocity: cache.velocity_score,
        dealQuality: cache.deal_quality_score,
        timePressure: cache.time_pressure_score,
        multiplier: Number(cache.multiplier),
        composite: cache.composite_score,
        tierLabel: cache.tier_label,
        tierCapped: cache.tier_capped,
      },
      lastScoredAt: cache.last_scored_at,
      triggerEvent: cache.last_trigger_event,

      address: m?.property?.address || lead?.property_address,
      city: lead?.city,
      county: lead?.county,
      sellerName: m?.owner?.fullName || lead?.full_name,
      currentStation: m?.currentStation || lead?.station || 'unknown',
      leadSource: m?.leadSource || lead?.source,
      leadAge,
      assignedAgent: m?.assignedAgent,

      hotSignal: m?.ariIntelligence?.hotSignal,
      hotSignalSource: 'Ari',
      hotNextMove: m?.ariIntelligence?.hotNextMove,

      flags: {
        hasDeadline: !!timeline?.sellerDeadline,
        deadlineDate: timeline?.sellerDeadline,
        hasLifeEvent: !!timeline?.lifeEventType,
        lifeEventType: timeline?.lifeEventType,
        hasCompetingOffer: !!timeline?.competingOffersPresent,
        competingOfferSpecificity: timeline?.competingOfferSpecificity,
      },

      motivationHistory: m?.motivationHistory || [],

      dealMath: {
        arv: financials?.arv,
        arvSource: financials?.arv_source,
        asIsValue: financials?.as_is_value,
        askingPrice: financials?.asking_price,
        offerAmount: financials?.offer_amount,
        spread,
        spreadHealthy: spread !== undefined ? spread >= 25000 : true,
        repairEstimate: financials?.repair_estimate,
        repairSource: financials?.repair_estimate_source,
      },

      missingFields: missing,

      lastCallDate: formatRelativeDate(m?.lastCallDate),
      lastTextDate: formatRelativeDate(m?.lastTextDate),
      lastEmailDate: formatRelativeDate(m?.lastEmailDate),
      lastMailDate: formatRelativeDate(m?.lastMailDate),

      coolingIndicator: m?.communications?.responsePending
        ? {
            responsePending: true,
            daysSinceResponse: m.communications.daysSinceLastSellerResponse ?? 0,
            attemptsSinceResponse: m.communications.outreachAttemptsSinceLastResponse ?? 0,
          }
        : undefined,

      cadenceHealth: ch,
      phone: m?.owner?.phones?.[0] || lead?.phone,
    } satisfies HotOpportunityData
  })

  const lastRankedAt = cacheRows[0]?.last_scored_at || null

  return { items, lastRankedAt }
}
