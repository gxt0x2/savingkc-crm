/**
 * Missed Call Auto-Text Messaging System
 *
 * Handles intelligent message variation to prevent repetitive texts
 * when sellers call multiple times within 48 hours.
 *
 * Best practices implemented:
 * - Agent-aware messaging based on which number was called
 * - Different tone for known leads vs unknown callers
 * - Message variants prevent repetition (1st, 2nd, 3+ calls)
 * - 48-hour window tracking to avoid spam
 * - Personalized with lead name when available
 */

import { getAgentRouting } from '@/lib/agent-routing'
import { supabase } from '@/lib/supabase-lazy'

export interface MissedCallContext {
  leadId: string | null
  leadName: string | null
  fromPhone: string
  calledNumber: string
  isKnownLead: boolean
}

export interface MissedCallResponse {
  shouldSend: boolean
  message: string | null
  agentName: string
  agentPhone: string
  variant: number
  delaySeconds: number
}

/**
 * Get count of missed call auto-texts sent to this number in last 48 hours
 */
async function getMissedCallTextCount(phone: string): Promise<number> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('lead_activities')
    .select('id')
    .eq('activity_type', 'sms')
    .eq('metadata->>to', phone)
    .eq('metadata->>trigger', 'missed_call_auto')
    .gte('created_at', fortyEightHoursAgo)

  return data?.length || 0
}

/**
 * Get time since last missed call text was sent (in minutes)
 */
async function getMinutesSinceLastText(phone: string): Promise<number | null> {
  const { data } = await supabase
    .from('lead_activities')
    .select('created_at')
    .eq('activity_type', 'sms')
    .eq('metadata->>to', phone)
    .eq('metadata->>trigger', 'missed_call_auto')
    .order('created_at', { ascending: false })
    .limit(1)

  if (!data || data.length === 0) return null

  const lastSent = new Date(data[0].created_at)
  const now = new Date()
  return Math.floor((now.getTime() - lastSent.getTime()) / 1000 / 60)
}

/**
 * Generate the appropriate missed call message based on context and call history
 */
function generateMessage(
  agentName: string,
  firstName: string,
  variant: number,
  isKnownLead: boolean
): string {
  // Known leads get casual, personal messages
  if (isKnownLead) {
    switch (variant) {
      case 0:
        // First missed call - casual "finishing up"
        return `Hey ${firstName}, sorry I missed you! Can I call you back in just a few minutes? I'm wrapping something up. - ${agentName}`
      case 1:
        // Second call in 48h - acknowledge they called again
        return `${firstName}, I see you called again — I'll call you right back! - ${agentName}`
      case 2:
        // Third call - urgency
        return `${firstName}, trying to reach you now! Calling you back ASAP. - ${agentName}`
      default:
        // 4+ calls - direct
        return `${firstName}, I'm on it — calling you now. - ${agentName}`
    }
  } else {
    // Unknown callers get professional but friendly messages
    switch (variant) {
      case 0:
        // First missed call
        return `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
      case 1:
        // Second call
        return `Hi, this is ${agentName} with Saving KC. I see you called again — are you trying to reach us about selling a property? Reply YES or call us back anytime.`
      case 2:
        // Third+ call - more direct
        return `${agentName} here from Saving KC. Looks like we keep missing each other! Reply YES or call back and we'll get you taken care of.`
      default:
        // 4+ calls - simple
        return `We're here! Reply YES or call ${agentName} at Saving KC anytime.`
    }
  }
}

/**
 * Determine if we should send a missed call text and what it should say
 *
 * Returns null if we should NOT send (too soon, too many recent texts, etc.)
 */
export async function getMissedCallResponse(
  context: MissedCallContext
): Promise<MissedCallResponse | null> {
  const { leadName, fromPhone, calledNumber, isKnownLead } = context

  // Get agent routing based on which number was called
  const routing = getAgentRouting(calledNumber)
  const agentName = routing.primary.name
  const agentPhone = routing.primary.phone

  // Check how many times we've texted them in last 48 hours
  const textCount = await getMissedCallTextCount(fromPhone)

  // Rate limiting: max 4 auto-texts in 48 hours
  if (textCount >= 4) {
    console.log(`[MISSED-CALL] Rate limit: ${fromPhone} has received ${textCount} texts in 48h`)
    return null
  }

  // Check time since last text - don't spam if they just got one
  const minutesSinceLast = await getMinutesSinceLastText(fromPhone)
  if (minutesSinceLast !== null && minutesSinceLast < 20) {
    console.log(`[MISSED-CALL] Too soon: ${fromPhone} got text ${minutesSinceLast}m ago`)
    return null
  }

  // Determine variant (0 = first, 1 = second, 2 = third, 3+ = fourth+)
  const variant = Math.min(textCount, 3)

  // Generate appropriate message
  const firstName = leadName?.split(' ')[0] || 'there'
  const message = generateMessage(agentName, firstName, variant, isKnownLead)

  // Delay timing:
  // - Known leads: 20-45 seconds (feels natural, not instant)
  // - Unknown: 60-120 seconds (gives them time to leave voicemail)
  // - Subsequent texts: shorter delay (15-30s) to show urgency
  let delaySeconds: number
  if (variant === 0) {
    delaySeconds = isKnownLead ? randomRange(20, 45) : randomRange(60, 120)
  } else {
    // Subsequent calls get faster response
    delaySeconds = randomRange(15, 30)
  }

  return {
    shouldSend: true,
    message,
    agentName,
    agentPhone,
    variant,
    delaySeconds,
  }
}

/**
 * Random integer between min and max (inclusive)
 */
function randomRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
