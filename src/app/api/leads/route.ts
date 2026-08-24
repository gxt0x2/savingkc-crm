import { NextRequest, NextResponse } from 'next/server'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
import { regenerateBriefing } from '@/lib/briefing-regen'
import { notifyNewLead } from '@/lib/ari-briefing'
import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { isMissingColumnError } from '@/lib/schema-compat'
import { supabase } from '@/lib/supabase-lazy'
import { recordSellerIntakeOperatingState } from '@/lib/operating-model/seller-intake'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { retiredLegacyLeadsPatchResponse } from '@/lib/server/legacy-leads-patch-retirement'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

type WebsiteLeadAttribution = Record<string, unknown>

const WEBSITE_LEAD_SOURCE = 'website_form'
const GOOGLE_ADS_LEAD_SOURCE = 'google_ads'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizePhone(phone: unknown): string | null {
  const digits = cleanString(phone)?.replace(/\D/g, '') ?? ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function phoneLookupVariants(phone: unknown, normalizedPhone: string | null): string[] {
  const raw = cleanString(phone)
  const digits = raw?.replace(/\D/g, '') ?? ''
  return [...new Set([
    normalizedPhone,
    raw,
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits,
    digits.length === 10 ? `1${digits}` : null,
  ].filter((value): value is string => Boolean(value)))]
}

function cleanSessionId(value: unknown): string | null {
  const sessionId = cleanString(value)
  return sessionId && UUID_RE.test(sessionId) ? sessionId : null
}

function cleanAttribution(value: unknown): WebsiteLeadAttribution {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as WebsiteLeadAttribution
    : {}
}

function attributionText(attribution: WebsiteLeadAttribution, key: string): string {
  const value = attribution[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isGoogleAdsAttribution(attribution: WebsiteLeadAttribution): boolean {
  return (
    attributionText(attribution, 'source') === 'google_ads' ||
    Boolean(attributionText(attribution, 'gclid')) ||
    Boolean(attributionText(attribution, 'gbraid')) ||
    Boolean(attributionText(attribution, 'wbraid')) ||
    attributionText(attribution, 'utm_source').replace(/[^a-z]/g, '') === 'google' &&
      ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'sem'].includes(attributionText(attribution, 'utm_medium'))
  )
}

async function findLeadIdByPhone(phoneVariants: string[]): Promise<string | null> {
  if (phoneVariants.length === 0) return null
  const { data } = await supabase
    .from('leads')
    .select('id')
    .in('phone', phoneVariants)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

async function findLeadBySessionId(sessionId: string | null): Promise<{ id: string; form_status?: string | null } | null> {
  if (!sessionId) return null
  const { data, error } = await supabase
    .from('leads')
    .select('id, form_status')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && isMissingColumnError(error)) {
    const { data: fallback, error: fallbackError } = await supabase
      .from('leads')
      .select('id')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fallbackError) console.error('[website-lead] session lookup fallback failed:', fallbackError)
    return fallback ?? null
  }

  if (error) {
    console.error('[website-lead] session lookup failed:', error)
    return null
  }

  return data ?? null
}

async function findLeadIdByEmail(email: string | null): Promise<string | null> {
  if (!email) return null
  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

async function findLeadIdByAddress(address: string | null): Promise<string | null> {
  if (!address) return null
  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('property_address', address)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

async function removeMergedPartialLead(sessionLead: { id: string; form_status?: string | null } | null, leadId: string): Promise<void> {
  if (!sessionLead || sessionLead.id === leadId || sessionLead.form_status !== 'partial') return
  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', sessionLead.id)
    .eq('form_status', 'partial')

  if (error) console.error('[website-lead] failed to remove merged partial lead:', error)
}

function withoutFormStatus<T extends Record<string, unknown>>(fields: T): Omit<T, 'form_status'> {
  const rest = { ...fields }
  delete rest.form_status
  return rest
}

async function insertWebsiteLead(fields: Record<string, unknown>, isGoogleAds: boolean): Promise<{ id: string } | null> {
  const insertFields = {
    ...fields,
    station: 'new',
    priority: isGoogleAds ? 'hot' : 'normal',
  }

  const { data, error } = await supabase
    .from('leads')
    .insert(insertFields)
    .select('id')
    .single()

  if (!error) return data

  if (isMissingColumnError(error) && 'form_status' in insertFields) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('leads')
      .insert(withoutFormStatus(insertFields))
      .select('id')
      .single()

    if (!fallbackError) return fallbackData
    console.error('[website-lead] Supabase insert fallback error:', fallbackError)
    return null
  }

  console.error('[website-lead] Supabase insert error:', error)
  return null
}

async function updateWebsiteLead(leadId: string, fields: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase
    .from('leads')
    .update(fields)
    .eq('id', leadId)

  if (!error) return true

  if (isMissingColumnError(error) && 'form_status' in fields) {
    const { error: fallbackError } = await supabase
      .from('leads')
      .update(withoutFormStatus(fields))
      .eq('id', leadId)

    if (!fallbackError) return true
    console.error('[website-lead] Supabase update fallback error:', fallbackError)
    return false
  }

  console.error('[website-lead] Supabase update error:', error)
  return false
}

async function upsertWebsiteLeadActivity(input: {
  leadId: string
  formSource: string
  sessionId: string | null
  address: string | null
  attribution: WebsiteLeadAttribution
  landingUrl: string | null
  referrer: string | null
  smsConsent: boolean
  isGoogleAds: boolean
}): Promise<string | null> {
  const metadata = {
    source: 'website_form_submit',
    form_source: input.formSource,
    form_status: 'submitted',
    form_submitted: true,
    traffic_source: input.isGoogleAds ? 'google_ads' : 'non_paid',
    session_id: input.sessionId,
    address: input.address,
    attribution: input.attribution,
    landing_url: input.landingUrl,
    referrer: input.referrer,
    sms_consent: input.smsConsent,
  }

  const { data, error } = await supabase
    .from('lead_activities')
    .insert({
      lead_id: input.leadId,
      activity_type: 'status_change',
      description: 'Website form submitted.',
      agent: 'System',
      metadata,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[website-lead] activity insert failed:', error)
    return null
  }

  return data?.id ?? null
}

async function triggerWebsiteLeadSideEffects(input: {
  leadId: string
  fullName: string
  address: string | null
  phone: string | null
  source: string
  formSource: string
  isGoogleAds: boolean
}) {
  const leadUrl = `/leads/${input.leadId}`
  const publicLeadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'}${leadUrl}`
  const addressPart = input.address ? ` at ${input.address}` : ''
  const label = input.isGoogleAds ? 'Google Ads website lead' : 'Website lead'
  const alertBody = `New ${label}: ${input.fullName}${addressPart}. Phone: ${input.phone || 'not provided'}. ${publicLeadUrl}`

  await Promise.allSettled([
    notifyNewLead(input.leadId, input.fullName, input.source),
    regenerateBriefing(input.leadId, 'website_lead_submitted', true),
  ])

  await sendTeamLeadAlert({
    leadId: input.leadId,
    smsBody: alertBody,
    trigger: 'website_lead_alert',
    source: input.formSource,
    trafficSource: input.isGoogleAds ? 'google_ads' : 'non_paid',
    push: {
      title: label,
      body: `${input.fullName}${addressPart}`,
      url: leadUrl,
      tag: `website-lead-${input.leadId}`,
    },
    callback: input.phone ? {
      leadPhone: input.phone,
      callerId: process.env.TWILIO_PHONE_NUMBER || '+18163077835',
      fullName: input.fullName,
      address: input.address,
      trigger: 'website_form_submit',
    } : false,
    metadata: {
      form_source: input.formSource,
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const name = cleanString(body.name) || 'Website Lead'
    const address = cleanString(body.address)
    const phone = cleanString(body.phone)
    const email = cleanString(body.email)?.toLowerCase() ?? null
    const formSource = cleanString(body.source) || WEBSITE_LEAD_SOURCE
    const sessionId = cleanSessionId(body.session_id)
    const attribution = cleanAttribution(body.attribution)
    const landingUrl = cleanString(body.landing_url) || cleanString(attribution.landingUrl)
    const referrer = cleanString(body.referrer) || cleanString(attribution.referrer)
    const smsConsent = body.sms_consent === true
    const normalizedPhone = normalizePhone(phone)
    const phoneVariants = phoneLookupVariants(phone, normalizedPhone)
    const isGoogleAds = isGoogleAdsAttribution(attribution)
    const leadSource = isGoogleAds ? GOOGLE_ADS_LEAD_SOURCE : WEBSITE_LEAD_SOURCE

    if (!normalizedPhone && !address && !email) {
      return NextResponse.json(
        { success: false, error: 'Phone, address, or email is required' },
        { status: 400, headers: corsHeaders },
      )
    }

    let leadId: string | null = null

    const sessionLead = await findLeadBySessionId(sessionId)

    // Prefer a real phone/email/address match over a partial capture row, then
    // fall back to the session row so final submit upgrades the partial lead.
    leadId =
      await findLeadIdByPhone(normalizedPhone ? [normalizedPhone] : []) ||
      await findLeadIdByEmail(email) ||
      await findLeadIdByAddress(address) ||
      sessionLead?.id ||
      await findLeadIdByPhone(phoneVariants)

    // If no existing lead, check prospects
    if (!leadId && normalizedPhone) {
      const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
      const { createEnrichedLeadFromProspect } = await import('@/lib/prospect-to-lead')

      const prospectMatches = await lookupProspectByPhone(normalizedPhone)
      if (prospectMatches.length > 0) {
        leadId = await createEnrichedLeadFromProspect(
          prospectMatches[0],
          normalizedPhone,
          WEBSITE_LEAD_SOURCE,
          'warm'
        )
      }
    }

    let cityState: { city?: string; state?: string; zip?: string; county?: string } = {}
    if (address) {
      try {
        const { parseAddressForCounty } = await import('@/lib/county-enrichment')
        const parsed = parseAddressForCounty(address)
        if (parsed) cityState = parsed
      } catch {
        // County enrichment is best-effort; lead intake should continue.
      }
    }

    const baseLeadFields = {
      full_name: name,
      ...(address ? { property_address: address } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(email ? { email } : {}),
      source: leadSource,
      form_status: 'submitted',
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(cityState.city ? { city: cityState.city } : {}),
      ...(cityState.state ? { state: cityState.state } : {}),
      ...(cityState.zip ? { zip: cityState.zip } : {}),
      ...(cityState.county ? { county: cityState.county } : {}),
    }

    // If still no lead, create bare lead
    if (!leadId) {
      const data = await insertWebsiteLead(baseLeadFields, isGoogleAds)

      if (!data?.id) {
        return NextResponse.json({ success: false, error: 'Lead insert failed' }, { status: 500, headers: corsHeaders })
      }

      leadId = data.id
    } else {
      const updated = await updateWebsiteLead(leadId, {
        ...baseLeadFields,
        ...(sessionLead?.id === leadId ? { station: 'new' } : {}),
        ...(isGoogleAds ? { priority: 'hot' } : {}),
      })

      if (!updated) {
        return NextResponse.json({ success: false, error: 'Lead update failed' }, { status: 500, headers: corsHeaders })
      }
    }

    const resolvedLeadId = leadId as string
    await removeMergedPartialLead(sessionLead, resolvedLeadId)

    const manifestId = await ensureManifestExists(resolvedLeadId)
    if (!manifestId) {
      console.error('[website-lead] manifest bootstrap failed for lead', resolvedLeadId)
      return NextResponse.json({ success: false, error: 'Manifest unavailable' }, { status: 500, headers: corsHeaders })
    }

    await updateManifestAndCascade(
      resolvedLeadId,
      (manifest) => {
        manifest.source = leadSource
        manifest.leadSource = leadSource
        manifest.priority = isGoogleAds ? 'hot' : 'warm'
        if (address && !manifest.property.address) manifest.property.address = address
        if (normalizedPhone && !manifest.owner.phones?.includes(normalizedPhone)) {
          manifest.owner.phones = [normalizedPhone, ...(manifest.owner.phones ?? [])]
        }
        if (email && !manifest.owner.emails?.includes(email)) {
          manifest.owner.emails = [email, ...(manifest.owner.emails ?? [])]
        }
        manifest.owner.fullName = name
        manifest.acquisition = {
          source: leadSource,
          channel: isGoogleAds ? 'google-ads' : 'website',
          attribution: {
            ...attribution,
            landingUrl: landingUrl ?? undefined,
            referrer: referrer ?? undefined,
            capturedAt: new Date().toISOString(),
          },
        }
      },
      leadSource,
    )

    const activityId = await upsertWebsiteLeadActivity({
      leadId: resolvedLeadId,
      formSource,
      sessionId,
      address,
      attribution,
      landingUrl,
      referrer,
      smsConsent,
      isGoogleAds,
    })

    try {
      await recordSellerIntakeOperatingState({
        leadId: resolvedLeadId,
        formSource,
        submissionKey: sessionId,
        phone: normalizedPhone || phone,
        email,
        address,
        smsConsent,
      })
    } catch (err) {
      // The operating-model projection is additive during migration. Preserve
      // successful lead capture while making projection failures observable.
      console.error('[website-lead] operating state projection failed:', err)
    }

    if (isGoogleAds && !externalSideEffectsDisabled()) {
      await enqueuePpcConversion({
        eventName: 'lead_submitted',
        eventCategory: 'form',
        leadId: resolvedLeadId,
        manifestId,
        activityId,
        dedupeKey: `lead:${resolvedLeadId}:website_lead_submitted`,
        optimizationRole: 'primary',
        conversionValue: 25,
        attribution,
        payload: {
          source: formSource,
          form_status: 'submitted',
          form_submitted: true,
          address: address ?? null,
        },
      })
    }

    if (!externalSideEffectsDisabled()) {
      try {
        await triggerWebsiteLeadSideEffects({
          leadId: resolvedLeadId,
          fullName: name,
          address,
          phone: normalizedPhone || phone,
          source: leadSource,
          formSource,
          isGoogleAds,
        })
      } catch (err) {
        console.error('[website-lead] side effects failed:', err)
      }
    }

    return NextResponse.json({ success: true, leadId: resolvedLeadId, manifestId }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads route error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}

export async function PATCH() {
  const unauthorized = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  return retiredLegacyLeadsPatchResponse()
}

export async function DELETE(req: NextRequest) {
  const unauthorized = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  try {
    const body = await req.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids array required' }, { status: 400, headers: corsHeaders })
    }

    // Every table in LEAD_FK_TABLES has a lead_id FK to leads.id. Adding a
    // new table with lead_id? Add it here too, or the leads delete will
    // fail with "violates foreign key constraint" and the UI will show it.
    //
    // This list was produced by probing the live Supabase schema (searching
    // information_schema for columns named lead_id). Re-run that probe if
    // this regresses again.
    //
    // `prospects.lead_id` is NULLed (not deleted) because prospects are
    // authoritative cold-outreach data, independent of lead lifecycle.
    const LEAD_FK_TABLES = [
      // Core
      'bookings',
      'lead_activities',
      'mojo_call_queue',
      'hot_opportunities_cache',
      'hot_score_audit_trail',
      // Comms
      'sms_messages',
      'sms_send_log',
      'sms_delivery_log',
      'notifications',
      'call_log',
      'call_sessions',
      'call_queue',
      'voicemail',
      'voicemails',
      'messages',
      'conversation_messages',
      // Feedback / audit
      'feedback',
      'feedback_submissions',
      'feedback_comments',
      'ari_audit_findings',
      'audit_log',
      'activity_log',
      'session_log',
      'error_log',
      // Agent / scoring
      'agent_scorecards',
      'lead_score_history',
      'score_snapshots',
      'temperature_history',
      'lead_analytics_daily',
      'kpi_snapshots',
      // Pipeline / tasks
      'stage_transitions',
      'tasks',
      'property_tasks',
      'appointments',
      'appointment_confirmations',
      'followups',
      'follow_ups',
      'reminders',
      'alerts',
      'assignments',
      'assigned_leads',
      'lead_stages',
      'kanban_positions',
      // Ari
      'ari_briefing_events',
      'ari_briefing_cache',
      'ari_nudges',
      'ari_signals',
      'ari_messages',
      'ari_tasks',
      'ari_follow_ups',
      'ari_context_cache',
      'briefing_cache',
      'nudges',
      // Mail / documents
      'mail_pieces',
      'documents',
      'photos',
      'attachments',
      // Listings / deals
      'listings',
      'deal_history',
      'deal_events',
      'offer_history',
      'escrow',
      'inspections',
      'closings',
      // Tagging / UX
      'lead_tags',
      'tags',
      'stars',
      'favorites',
      'comments',
      'reviews',
      // Ghost / pipeline events
      'ghost_protocol_log',
      'pipeline_events',
      // Dashboards
      'dashboards',
      'daily_digest',
      'weekly_digest',
      'reports',
      'exports',
      // manifests last so its ON DELETE CASCADE children (manifest_history etc)
      // get cleaned up in the same pass.
      'manifests',
    ]

    const results = await Promise.allSettled([
      ...LEAD_FK_TABLES.map(table =>
        supabase.from(table).delete().in('lead_id', ids),
      ),
      supabase.from('prospects').update({ lead_id: null }).in('lead_id', ids),
    ])

    // Surface any unexpected errors from the cleanup step.
    const cleanupErrors = results
      .map((r, i) => r.status === 'rejected' ? `step${i}: ${String(r.reason).slice(0, 200)}` : null)
      .filter(Boolean)
    if (cleanupErrors.length > 0) {
      console.error('Lead cleanup errors (non-fatal, continuing):', cleanupErrors)
    }

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)

    if (error) {
      console.error('Supabase delete error:', error)
      return NextResponse.json(
        { success: false, error: error.message, cleanupErrors },
        { status: 500, headers: corsHeaders },
      )
    }

    return NextResponse.json({ success: true, deleted: ids.length, cleanupErrors }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads DELETE error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    )
  }
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    const { data, error, count } = await supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json({ success: true, leads: data, total: count }, { headers: corsHeaders })
  } catch (err) {
    console.error('leads GET error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
