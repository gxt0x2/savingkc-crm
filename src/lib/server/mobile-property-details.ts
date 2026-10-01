import { supabaseAdmin } from '@/lib/supabase/admin'

const OCCUPANCY_VALUES = new Set(['owner', 'tenant', 'vacant', 'unknown'])

export type MobilePropertyPatch = {
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  yearBuilt: number | null
  occupancyStatus: 'owner' | 'tenant' | 'vacant' | 'unknown' | null
  expectedUpdatedAt: string | null
}

export class MobilePropertyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
  }
}

function boundedNumber(value: unknown, label: string, min: number, max: number, integer = false): number | null {
  if (value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new MobilePropertyError(`${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`, 400)
  }
  return value
}

export function parseMobilePropertyPatch(value: unknown): MobilePropertyPatch {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const expectedUpdatedAt = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim() : null
  if (expectedUpdatedAt && Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw new MobilePropertyError('Refresh the property before saving changes.', 400)
  }
  const occupancy = input.occupancyStatus
  if (occupancy !== null && (typeof occupancy !== 'string' || !OCCUPANCY_VALUES.has(occupancy))) {
    throw new MobilePropertyError('Choose a valid occupancy.', 400)
  }
  return {
    bedrooms: boundedNumber(input.bedrooms, 'Bedrooms', 0, 20),
    bathrooms: boundedNumber(input.bathrooms, 'Bathrooms', 0, 20),
    sqft: boundedNumber(input.sqft, 'Square feet', 0, 100_000, true),
    yearBuilt: boundedNumber(input.yearBuilt, 'Year built', 1700, new Date().getFullYear() + 1, true),
    occupancyStatus: occupancy as MobilePropertyPatch['occupancyStatus'],
    expectedUpdatedAt,
  }
}

export async function updateMobilePropertyDetails(input: {
  leadId: string
  actor: { email: string; name: string }
  patch: MobilePropertyPatch
}) {
  const db = supabaseAdmin()
  const linkResult = await db
    .from('crm_lead_entity_links')
    .select('property_id')
    .eq('lead_id', input.leadId)
    .maybeSingle()
  if (linkResult.error) throw new MobilePropertyError(linkResult.error.message, 503)
  let link = linkResult.data

  let projectedForThisCommand = false
  if (!link?.property_id) {
    const { error: projectionError } = await db.rpc('refresh_crm_entity_for_lead', { target_lead_id: input.leadId })
    if (projectionError) throw new MobilePropertyError(`The canonical property could not be prepared: ${projectionError.message}`, 503)
    const projected = await db
      .from('crm_lead_entity_links')
      .select('property_id')
      .eq('lead_id', input.leadId)
      .maybeSingle()
    if (projected.error) throw new MobilePropertyError(projected.error.message, 503)
    link = projected.data
    projectedForThisCommand = true
  }
  if (!link?.property_id) {
    throw new MobilePropertyError('Add a canonical property address before saving property facts.', 409)
  }

  let expectedUpdatedAt = input.patch.expectedUpdatedAt
  if (!expectedUpdatedAt) {
    if (!projectedForThisCommand) throw new MobilePropertyError('Refresh the property before saving changes.', 409)
    const { data: baseline, error: baselineError } = await db
      .from('crm_properties')
      .select('updated_at')
      .eq('id', link.property_id)
      .maybeSingle()
    if (baselineError) throw new MobilePropertyError(baselineError.message, 503)
    if (!baseline?.updated_at) throw new MobilePropertyError('Refresh the property before saving changes.', 409)
    expectedUpdatedAt = baseline.updated_at
  }

  const { data: property, error: updateError } = await db
    .from('crm_properties')
    .update({
      bedrooms: input.patch.bedrooms,
      bathrooms: input.patch.bathrooms,
      sqft: input.patch.sqft,
      year_built: input.patch.yearBuilt,
      occupancy_status: input.patch.occupancyStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', link.property_id)
    .eq('updated_at', expectedUpdatedAt)
    .select('id,bedrooms,bathrooms,sqft,year_built,occupancy_status,updated_at')
    .maybeSingle()
  if (updateError) throw new MobilePropertyError(updateError.message, 503)
  if (!property) throw new MobilePropertyError('Property facts changed on another device. Refresh before saving again.', 409)

  const { error: auditError } = await db.from('lead_activities').insert({
    lead_id: input.leadId,
    activity_type: 'property_update',
    description: 'Updated property facts',
    agent: input.actor.name,
    metadata: {
      source: 'mobile_app',
      actor_email: input.actor.email,
      property_id: property.id,
      fields: ['bedrooms', 'bathrooms', 'sqft', 'year_built', 'occupancy_status'],
    },
  })

  return {
    property: {
      id: property.id,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sqft: property.sqft,
      yearBuilt: property.year_built,
      occupancyStatus: property.occupancy_status,
      updatedAt: property.updated_at,
    },
    warning: auditError ? 'Property facts were saved, but the audit entry could not be written.' : undefined,
  }
}
