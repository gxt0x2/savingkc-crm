/**
 * SMS Template Library
 * Lookup and merge field resolution for SMS templates
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface SmsTemplate {
  id: string
  name: string
  category: string
  body: string
  merge_fields: string[]
  is_active: boolean
  usage_count: number
}

/**
 * Get a template by name
 */
export async function getTemplate(name: string): Promise<SmsTemplate | null> {
  const { data } = await supabase
    .from('sms_templates')
    .select('*')
    .eq('name', name)
    .eq('is_active', true)
    .single()

  return data as SmsTemplate | null
}

/**
 * Get all templates in a category
 */
export async function getTemplatesByCategory(category: string): Promise<SmsTemplate[]> {
  const { data } = await supabase
    .from('sms_templates')
    .select('*')
    .eq('category', category)
    .eq('is_active', true)
    .order('name')

  return (data || []) as SmsTemplate[]
}

/**
 * Get all active templates
 */
export async function getAllTemplates(): Promise<SmsTemplate[]> {
  const { data } = await supabase
    .from('sms_templates')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('name')

  return (data || []) as SmsTemplate[]
}

/**
 * Resolve merge fields in a template body using lead data
 */
export function resolveTemplate(
  body: string,
  lead: { full_name?: string | null; property_address?: string | null }
): string {
  let resolved = body
  const firstName = lead.full_name?.split(' ')[0] || 'there'
  const address = lead.property_address || 'your property'

  resolved = resolved.replace(/\{firstName\}/g, firstName)
  resolved = resolved.replace(/\{propertyAddress\}/g, address)

  return resolved
}

/**
 * Increment usage count for a template
 */
export async function incrementUsage(name: string): Promise<void> {
  const { data: template } = await supabase
    .from('sms_templates')
    .select('usage_count')
    .eq('name', name)
    .single()

  if (template) {
    await supabase
      .from('sms_templates')
      .update({ usage_count: (template.usage_count || 0) + 1 })
      .eq('name', name)
  }
}

/* ─────────────────────────────────────────────
 * Appointment Reminder Sequence Templates
 * ───────────────────────────────────────────── */

export interface AppointmentTemplate {
  name: string
  category: 'appointment' | 'ghost_protocol'
  timing: string
  asks_for_reply: boolean
  body: string
  merge_fields: string[]
}

export const appointmentTemplates: AppointmentTemplate[] = [
  {
    name: 'appt_confirm_phone',
    category: 'appointment',
    timing: 'booking',
    asks_for_reply: true,
    merge_fields: ['firstName', 'date', 'time', 'agentName', 'twilioNumber'],
    body: `Hey {firstName}! This is {agentName} with Saving KC Homebuyers. Just wanted to confirm our phone call for {date} at {time}. We're looking forward to chatting with you about your property.\n\nCould you reply YES to confirm? That way we'll make sure {agentName} has your time blocked off.\n\nQuestions anytime: {twilioNumber}`,
  },
  {
    name: 'appt_confirm_inperson',
    category: 'appointment',
    timing: 'booking',
    asks_for_reply: true,
    merge_fields: ['firstName', 'date', 'time', 'address', 'agentName', 'twilioNumber'],
    body: `Hey {firstName}! This is {agentName} with Saving KC Homebuyers. We're all set to meet at {address} on {date} at {time}.\n\nCould you reply YES to confirm? We want to make sure we've got the right date and time for you.\n\nIf anything changes, just text us here or call {twilioNumber}.`,
  },
  {
    name: 'appt_value_add_phone',
    category: 'appointment',
    timing: 'T-24h',
    asks_for_reply: true,
    merge_fields: ['firstName', 'date', 'time'],
    body: `Hi {firstName} — quick question before our call tomorrow ({date} at {time}). What's the #1 thing you'd like to get figured out about your situation? Knowing ahead of time helps us come prepared with real answers instead of generic info.\n\nJust shoot a quick reply whenever you get a chance!`,
  },
  {
    name: 'appt_value_add_inperson',
    category: 'appointment',
    timing: 'T-24h',
    asks_for_reply: true,
    merge_fields: ['firstName', 'date', 'time', 'address'],
    body: `Hi {firstName} — looking forward to seeing {address} tomorrow ({date} at {time}). Quick question: is there anything about the property or your timeline we should know going in? Even a heads-up like "the basement has water issues" saves us both time.\n\nJust reply here whenever you get a sec!`,
  },
  {
    name: 'appt_morning_confirm',
    category: 'appointment',
    timing: 'T-3h',
    asks_for_reply: true,
    merge_fields: ['firstName', 'time'],
    body: `Good morning {firstName}! Just a friendly check-in — we're still on for {time} today, right? Reply YES and we'll see you then. If something came up, no worries at all, just let us know and we'll reschedule.`,
  },
  {
    name: 'appt_lockin_30min',
    category: 'appointment',
    timing: 'T-30min',
    asks_for_reply: false,
    merge_fields: ['firstName', 'time'],
    body: `Hey {firstName}, just a heads-up — we're about 30 minutes out from our {time} appointment. Talk soon!`,
  },
  {
    name: 'appt_enroute_15min',
    category: 'appointment',
    timing: 'T-15min',
    asks_for_reply: false,
    merge_fields: ['firstName', 'address', 'agentName'],
    body: `{firstName}, {agentName} is heading your way now — should be at {address} in about 15 minutes. See you shortly!`,
  },
  {
    name: 'appt_ghost_pattern_interrupt',
    category: 'appointment',
    timing: 'ghost_trigger',
    asks_for_reply: true,
    merge_fields: ['firstName'],
    body: `Hey {firstName}, totally understand if now isn't the right time — life gets busy. We'd rather know either way so we can help when it works best for you. A quick reply like "not yet" or "let's reschedule" helps a ton. No pressure at all.`,
  },
  {
    name: 'ghost_appt_pattern_interrupt',
    category: 'ghost_protocol',
    timing: 'Ghost risk >= 50',
    asks_for_reply: true,
    merge_fields: ['firstName', 'date', 'time', 'agentName'],
    body: `{firstName}, I want to respect your time. If something changed or the timing isn't right, no problem at all — just let me know and I'll take you off the schedule. Otherwise, we're still planning on {date} at {time}. Either way, a quick reply helps me out. — {agentName}, Saving KC`,
  },
  {
    name: 'ghost_appt_casey_alert',
    category: 'ghost_protocol',
    timing: 'Ghost Step 2 — internal',
    asks_for_reply: false,
    merge_fields: ['firstName', 'ghostScore', 'lastResponse', 'date', 'time', 'phone'],
    body: `⚠️ GHOST RISK: {firstName} — Score {ghostScore}. Last response: {lastResponse}. Appt: {date} at {time}. Call now: {phone}`,
  },
  {
    name: 'ghost_appt_door_open',
    category: 'ghost_protocol',
    timing: 'Ghost Step 3 — final',
    asks_for_reply: false,
    merge_fields: ['firstName', 'agentName'],
    body: `No worries {firstName}. I'll keep your info on file — when the timing is right, we're here. Just text this number anytime. — {agentName}, Saving KC`,
  },
]

/**
 * Synchronous merge-field resolver for appointment templates.
 * Looks up a template by name from the in-memory array and replaces
 * all {field} placeholders with the provided vars.
 *
 * Usage:
 *   renderTemplate('appt_confirm_phone', { firstName: 'Mike', date: 'April 5', time: '2:00 PM', agentName: 'Casey', twilioNumber: '(816) 307-7835' })
 */
export function renderTemplate(
  name: string,
  vars: Record<string, string>
): string {
  const tpl = appointmentTemplates.find((t) => t.name === name)
  if (!tpl) {
    throw new Error(`SMS template "${name}" not found`)
  }

  let result = tpl.body
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return result
}
