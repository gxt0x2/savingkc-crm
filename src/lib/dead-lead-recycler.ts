// RCY-01: Dead Lead Recycler
// Night 4 Phase 3: 90/180 day re-evaluation with fresh data checks

import type { SupabaseClient } from '@supabase/supabase-js'

interface RecycleCandidate {
  lead_id: string
  lead_name: string
  property_address: string
  days_dead: number
  reason: string
  priority: 'medium' | 'high'
}

/**
 * Find leads that have been in Dead/Nurture stage for 90+ or 180+ days
 * and check if conditions have changed (new data available)
 */
export async function findRecycleCandidates(
  supabase: SupabaseClient,
  daysThreshold: 90 | 180 = 90
): Promise<RecycleCandidate[]> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold)

  // Find leads marked as dead/nurture for the threshold period
  const { data: deadLeads } = await supabase
    .from('leads')
    .select('id, full_name, property_address, station, priority, created_at, updated_at')
    .eq('station', 'dead')
    .lt('updated_at', cutoffDate.toISOString())
    .order('updated_at', { ascending: true })

  if (!deadLeads || deadLeads.length === 0) {
    return []
  }

  const candidates: RecycleCandidate[] = []

  for (const lead of deadLeads) {
    const daysDead = Math.floor(
      (Date.now() - new Date(lead.updated_at || lead.created_at).getTime()) / (1000 * 60 * 60 * 24)
    )

    // Check if conditions have changed
    const reasons: string[] = []

    // Check for new lead activities (someone might have called/emailed recently)
    const { data: recentActivities } = await supabase
      .from('lead_activities')
      .select('type, created_at')
      .eq('lead_id', lead.id)
      .gte('created_at', cutoffDate.toISOString())
      .limit(1)

    if (recentActivities && recentActivities.length > 0) {
      reasons.push('New activity detected')
    }

    // Check for property data enrichment (new county data, tax changes, etc.)
    // This would require checking data_enriched_at timestamp if it exists
    const { data: leadData } = await supabase
      .from('leads')
      .select('data_enriched_at, tax_assessment, last_sale_date')
      .eq('id', lead.id)
      .single()

    if (leadData?.data_enriched_at) {
      const enrichedDate = new Date(leadData.data_enriched_at)
      if (enrichedDate > cutoffDate) {
        reasons.push('Property data updated')
      }
    }

    // Check if tax assessment exists (new county data)
    if (leadData?.tax_assessment && !lead.priority) {
      reasons.push('Tax assessment data now available')
    }

    // Check if new sale recorded (ownership change indicator)
    if (leadData?.last_sale_date) {
      const saleDate = new Date(leadData.last_sale_date)
      if (saleDate > cutoffDate) {
        reasons.push('Property sold recently - new owner')
      }
    }

    // TODO: When skip trace integration exists, check for new phone numbers
    // TODO: When county data integration exists, check for tax delinquency status change
    // TODO: When foreclosure data exists, check for pre-foreclosure status

    // If any conditions changed, add to candidates
    if (reasons.length > 0) {
      candidates.push({
        lead_id: lead.id,
        lead_name: lead.full_name || 'Unknown',
        property_address: lead.property_address || 'Unknown address',
        days_dead: daysDead,
        reason: reasons.join(', '),
        priority: daysDead >= 180 ? 'medium' : 'high', // Older = lower priority
      })
    }
  }

  return candidates
}

/**
 * Generate Ari briefing events for recycle candidates
 */
export async function generateRecycleAlerts(
  supabase: SupabaseClient,
  daysThreshold: 90 | 180 = 90
): Promise<number> {
  const candidates = await findRecycleCandidates(supabase, daysThreshold)

  let alertsCreated = 0

  for (const candidate of candidates) {
    const { error } = await supabase.from('ari_briefing_events').insert({
      event_type: 'dead_lead_recycler',
      priority: candidate.priority,
      title: `♻️ ${candidate.lead_name} — Dead ${candidate.days_dead} days, conditions changed`,
      description: `Lead was marked dead ${candidate.days_dead} days ago. ${candidate.reason}. Consider re-engagement.`,
      lead_id: candidate.lead_id,
      metadata: {
        days_dead: candidate.days_dead,
        threshold: daysThreshold,
        change_reasons: candidate.reason,
        property_address: candidate.property_address,
      },
      dismissed: false,
    })

    if (!error) {
      alertsCreated++
    }
  }

  return alertsCreated
}

/**
 * Auto-recycle leads that meet criteria
 * Moves them from dead back to not_contacted with high priority
 */
export async function autoRecycleLeads(
  supabase: SupabaseClient,
  daysThreshold: 90 | 180 = 90,
  autoRecycle: boolean = false
): Promise<{ candidates: number; recycled: number; alerted: number }> {
  const candidates = await findRecycleCandidates(supabase, daysThreshold)

  let recycled = 0
  let alerted = 0

  for (const candidate of candidates) {
    // Generate alert
    const { error: alertError } = await supabase.from('ari_briefing_events').insert({
      event_type: 'dead_lead_recycler',
      priority: candidate.priority,
      title: `♻️ ${candidate.lead_name} — Conditions changed after ${candidate.days_dead} days dead`,
      description: `${candidate.reason}. Consider re-engagement.`,
      lead_id: candidate.lead_id,
      metadata: {
        days_dead: candidate.days_dead,
        threshold: daysThreshold,
        change_reasons: candidate.reason,
        property_address: candidate.property_address,
      },
      dismissed: false,
    })

    if (!alertError) alerted++

    // If auto-recycle enabled, move back to not_contacted
    if (autoRecycle) {
      const { error: recycleError } = await supabase
        .from('leads')
        .update({
          station: 'not_contacted',
          priority: 'high',
          notes: `[Auto-recycled ${new Date().toISOString().split('T')[0]}] Previously dead for ${candidate.days_dead} days. ${candidate.reason}. Original notes: ${candidate.lead_name}`,
        })
        .eq('id', candidate.lead_id)

      if (!recycleError) {
        recycled++

        // Log the recycle action
        await supabase.from('lead_activities').insert({
          lead_id: candidate.lead_id,
          type: 'status_change',
          description: `♻️ Auto-recycled from dead (${candidate.days_dead} days) — ${candidate.reason}`,
          agent: 'Ari Recycler',
          metadata: {
            old_station: 'dead',
            new_station: 'not_contacted',
            days_dead: candidate.days_dead,
            recycle_reason: candidate.reason,
            threshold: daysThreshold,
          },
        })
      }
    }
  }

  return {
    candidates: candidates.length,
    recycled,
    alerted,
  }
}

/**
 * Get summary stats for dead leads
 */
export async function getDeadLeadStats(supabase: SupabaseClient): Promise<{
  total_dead: number
  dead_30_90_days: number
  dead_90_180_days: number
  dead_180_plus_days: number
  recycle_candidates_90: number
  recycle_candidates_180: number
}> {
  const now = Date.now()
  const day30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const day90 = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()
  const day180 = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString()

  const { data: allDead } = await supabase
    .from('leads')
    .select('id, updated_at, created_at')
    .eq('station', 'dead')

  const total = allDead?.length || 0

  const dead30_90 = allDead?.filter(l => {
    const date = new Date(l.updated_at || l.created_at)
    return date >= new Date(day90) && date < new Date(day30)
  }).length || 0

  const dead90_180 = allDead?.filter(l => {
    const date = new Date(l.updated_at || l.created_at)
    return date >= new Date(day180) && date < new Date(day90)
  }).length || 0

  const dead180plus = allDead?.filter(l => {
    const date = new Date(l.updated_at || l.created_at)
    return date < new Date(day180)
  }).length || 0

  const candidates90 = await findRecycleCandidates(supabase, 90)
  const candidates180 = await findRecycleCandidates(supabase, 180)

  return {
    total_dead: total,
    dead_30_90_days: dead30_90,
    dead_90_180_days: dead90_180,
    dead_180_plus_days: dead180plus,
    recycle_candidates_90: candidates90.length,
    recycle_candidates_180: candidates180.length,
  }
}
