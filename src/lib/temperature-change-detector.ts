// TMP-04: Temperature Change Alerts
// Night 4 Phase 1: Ari Doctrine 2 - Lead Lifecycle Events

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateTemperature, type Temperature } from './lead-temperature'

type Lead = {
  id: string
  full_name: string | null
  priority: string | null
  station: string | null
  created_at: string
}

interface TemperatureChange {
  lead_id: string
  lead_name: string
  old_temp: Temperature
  new_temp: Temperature
  reason: string
}

const TEMP_ORDER: Temperature[] = ['cold', 'cool', 'warm', 'hot']

function getTempIndex(temp: Temperature): number {
  return TEMP_ORDER.indexOf(temp)
}

function describeTempChange(old_temp: Temperature, new_temp: Temperature, reason: string): string {
  const oldIdx = getTempIndex(old_temp)
  const newIdx = getTempIndex(new_temp)

  if (newIdx > oldIdx) {
    // Heating up
    if (new_temp === 'hot') {
      return `[HOT] went HOT — ${reason}`
    } else if (new_temp === 'warm') {
      return `[WARM] warming up — ${reason}`
    }
  } else if (newIdx < oldIdx) {
    // Cooling down
    if (new_temp === 'cold') {
      return `[COLD] went COLD — ${reason}`
    } else if (new_temp === 'cool') {
      return `[COLD] cooling off — ${reason}`
    }
  }

  return `temperature changed from ${old_temp} to ${new_temp} — ${reason}`
}

/**
 * Check if a lead's temperature has changed significantly since last check
 * Creates Ari briefing event if major change detected (Hot↔Cold, Warm↔Cool, etc.)
 */
export async function detectTemperatureChanges(
  supabase: SupabaseClient<any>,
  lead: Lead,
  reason: string = 'activity update'
): Promise<void> {
  const currentTemp = calculateTemperature({
    priority: lead.priority,
    station: lead.station,
    created_at: lead.created_at,
  })

  // Check for last temperature record
  const { data: lastTempActivity } = await supabase
    .from('lead_activities')
    .select('metadata')
    .eq('lead_id', lead.id)
    .eq('type', 'temperature_snapshot')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastTemp = lastTempActivity?.metadata?.temperature as Temperature | undefined

  // If this is first snapshot or temp hasn't changed significantly, just update snapshot
  if (!lastTemp) {
    // Create initial snapshot
    await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      type: 'temperature_snapshot',
      description: `Temperature snapshot: ${currentTemp}`,
      agent: 'System',
      metadata: {
        temperature: currentTemp,
        reason,
      },
    })
    return
  }

  // Check if change is significant (moved up or down in tier)
  const oldIdx = getTempIndex(lastTemp)
  const newIdx = getTempIndex(currentTemp)

  if (oldIdx !== newIdx) {
    // Significant change detected - create Ari briefing event
    const leadName = lead.full_name || 'Unknown Lead'
    const description = describeTempChange(lastTemp, currentTemp, reason)

    // Determine priority based on direction and magnitude
    let priority: 'low' | 'medium' | 'high' = 'medium'
    const magnitude = Math.abs(newIdx - oldIdx)

    if (newIdx > oldIdx) {
      // Heating up - higher priority
      if (currentTemp === 'hot') {
        priority = 'high' // Just went hot
      } else if (magnitude >= 2) {
        priority = 'high' // Jumped 2+ tiers
      }
    } else {
      // Cooling down - medium priority
      if (currentTemp === 'cold' && magnitude >= 2) {
        priority = 'high' // Fell to cold from warm/hot
      }
    }

    // Create Ari briefing event
    await supabase.from('ari_briefing_events').insert({
      event_type: 'temperature_change',
      priority,
      title: `${leadName} ${description}`,
      description: `Lead temperature changed from ${lastTemp} to ${currentTemp}`,
      lead_id: lead.id,
      metadata: {
        old_temperature: lastTemp,
        new_temperature: currentTemp,
        reason,
        magnitude,
      },
      dismissed: false,
    })

    // Update temperature snapshot
    await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      type: 'temperature_snapshot',
      description: `Temperature changed: ${lastTemp} → ${currentTemp}`,
      agent: 'System',
      metadata: {
        temperature: currentTemp,
        previous_temperature: lastTemp,
        reason,
      },
    })
  }
}

/**
 * Bulk scan all leads and detect temperature changes
 * Should be run periodically (daily) to catch gradual changes
 */
export async function scanAllLeadsForTemperatureChanges(
  supabase: SupabaseClient<any>
): Promise<TemperatureChange[]> {
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, priority, station, created_at')
    .neq('station', 'dead') // Exclude dead leads
    .order('created_at', { ascending: false })

  const changes: TemperatureChange[] = []

  if (!leads) return changes

  for (const lead of leads) {
    try {
      await detectTemperatureChanges(supabase, lead, 'daily temperature scan')
    } catch (err) {
      console.error(`Failed to check temperature for lead ${lead.id}:`, err)
    }
  }

  return changes
}
