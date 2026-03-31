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
