import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
import { startPpcFormLeadAgentCallback } from '@/lib/lead-form-callback'
import { buildUserIdentifiers } from '@/lib/ppc/enhanced-conversions'
import { DEFAULT_PPC_CAMPAIGN, ppcCampaignForPagePath } from '@/lib/ppc/campaigns'
import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { getPpcRequestContext } from '@/lib/ppc/request-context'
import {
  CONDITION_TO_OVERALL,
  recordPpcTrackingEvent,
  SITUATION_TO_TAG,
  TIMELINE_TO_URGENCY,
} from '@/lib/ppc/tracking-events'
import { notifyNewLead } from '@/lib/ari-briefing'
import { regenerateBriefing } from '@/lib/briefing-regen'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { sendPushToAgents } from '@/lib/push-notifications'
import { safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

export const runtime = 'nodejs'

// Offline queue path — used when Supabase writes fail (e.g. legacy keys
// disabled). Each line is a JSON object that we can replay later when the
// backend is healthy. The file lives next to the preview workspace so it's
// easy to find without scratching around in /tmp.
const QUEUE_DIR = join(process.env.HOME ?? '/tmp', 'savingkc-landing-preview')
const QUEUE_FILE = join(QUEUE_DIR, 'ppc-leads-queue.jsonl')
const PPC_SOURCE = 'ppc-landing'

async function queueLeadOffline(payload: unknown, error: unknown): Promise<void> {
  try {
    await mkdir(QUEUE_DIR, { recursive: true })
    const line = JSON.stringify({
      at: new Date().toISOString(),
      reason: error instanceof Error ? error.message : String(error),
      payload,
    }) + '\n'
    await appendFile(QUEUE_FILE, line, 'utf8')
  } catch (writeErr) {
    console.error('[ppc/lead] offline queue write failed', writeErr)
  }
}

const SituationSchema = z.enum([
  'tax-delinquent',
  'inherited',
  'tired-landlord',
  'condition',
  'life-event',
  'other',
])
const TimelineSchema = z.enum(['asap', '60-days', 'flexible', 'exploring'])
const ConditionSchema = z.enum(['good', 'needs-work', 'major-repair', 'vacant'])
const AuctionStatusSchema = z.enum(['yes', 'no', 'not-sure'])

const AttributionSchema = z
  .object({
    utm_source: z.string().max(120).optional(),
    utm_medium: z.string().max(120).optional(),
    utm_campaign: z.string().max(180).optional(),
    utm_term: z.string().max(180).optional(),
    utm_content: z.string().max(180).optional(),
    keyword: z.string().max(180).optional(),
    matchtype: z.string().max(80).optional(),
    campaignid: z.string().max(180).optional(),
    adgroupid: z.string().max(180).optional(),
    gclid: z.string().max(180).optional(),
    gbraid: z.string().max(180).optional(),
    wbraid: z.string().max(180).optional(),
    oppref: z.string().max(240).optional(),
    gad_source: z.string().max(120).optional(),
    gad_campaignid: z.string().max(180).optional(),
    gad_adgroupid: z.string().max(180).optional(),
    referrer: z.string().max(500).optional(),
    landingUrl: z.string().max(500).optional(),
  })
  .optional()

const BodySchema = z.object({
  intent: z.enum(['address_capture', 'potential', 'autosave', 'submit']).optional(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  address: z.string().min(3).max(200).optional(),
  addressSource: z.enum(['typed', 'google_places']).optional(),
  situation: SituationSchema.optional(),
  timeline: TimelineSchema.optional(),
  condition: ConditionSchema.optional(),
  auctionStatus: AuctionStatusSchema.optional(),
  contact: z
    .object({
      name: z.string().max(120).optional(),
      phone: z.string().max(30).optional(),
      email: z.string().max(200).optional(),
    })
    .optional(),
  sessionId: z.string().max(160).optional(),
  visitorId: z.string().max(160).optional(),
  smsConsent: z.boolean().optional(),
  attribution: AttributionSchema,
})

const TIMELINE_TO_PRIORITY: Record<z.infer<typeof TimelineSchema>, 'hot' | 'warm'> = {
  asap: 'hot',
  '60-days': 'warm',
  flexible: 'warm',
  exploring: 'warm',
}

const SMOKE_MARKER_RE = /(^|[^a-z0-9])(codex|dummy|probe|smoke|test)([^a-z0-9]|$)/i
const FAKE_PHONE_RE = /^1?816555/

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function normalizePhoneOrNull(phone: string | null | undefined): string | null {
  const raw = cleanText(phone)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return normalizePhone(raw)
}

function normalizeEmailOrNull(email: string | null | undefined): string | null {
  const value = cleanText(email)?.toLowerCase()
  if (!value) return null
  const parsed = z.string().email().safeParse(value)
  return parsed.success ? value : null
}

function hasSmokeMarker(...values: Array<unknown>): boolean {
  return values.some((value) => typeof value === 'string' && SMOKE_MARKER_RE.test(value))
}

function pagePathFromAttribution(attribution: z.infer<typeof AttributionSchema>): string {
  const landingUrl = cleanText(attribution?.landingUrl)
  if (!landingUrl) return '/ppc'

  try {
    const path = new URL(landingUrl).pathname
    if (path.startsWith('/ppc-tax')) return '/ppc-tax'
    if (path.startsWith('/ppc')) return '/ppc'
    return path || '/ppc'
  } catch {
    if (landingUrl.startsWith('/ppc-tax')) return '/ppc-tax'
    if (landingUrl.startsWith('/ppc')) return '/ppc'
    return '/ppc'
  }
}

function isFakePhone(value: string | null | undefined): boolean {
  return Boolean(value && (FAKE_PHONE_RE.test(value.replace(/\D/g, '')) || isInternalTestPhone(value)))
}

function isSmokeMarkedSubmit(input: {
  fullName: string | null
  email: string | null
  phone: string | null
  address?: string
  sessionId?: string
  visitorId?: string
  attribution: z.infer<typeof AttributionSchema>
}): boolean {
  const attribution = input.attribution ?? {}
  const hasMarker = hasSmokeMarker(
    input.fullName,
    input.email,
    input.address,
    input.sessionId,
    input.visitorId,
    attribution.gclid,
    attribution.gbraid,
    attribution.wbraid,
  )
  const hasFakeContact = (
    isFakePhone(input.phone) ||
    Boolean(input.email?.endsWith('@example.com')) ||
    Boolean(input.fullName && /^codex smoke test\b/i.test(input.fullName))
  )

  return hasMarker && hasFakeContact
}

async function findExistingPpcLeadId({
  phone,
  email,
  address,
}: {
  phone?: string | null
  email?: string | null
  address?: string
}): Promise<string | null> {
  if (phone) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  if (email) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('email', email)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  if (!address) return null

  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('source', PPC_SOURCE)
    .eq('property_address', address)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

type PpcFormActivityInput = {
  leadId: string
  source: 'ppc_form_potential' | 'ppc_form_autosave' | 'ppc_form_submit'
  description: string
  formStatus: 'potential_no_submit' | 'stage_3_complete_no_submit' | 'submitted'
  step: number
  address?: string
  addressSource?: 'typed' | 'google_places'
  situation?: z.infer<typeof SituationSchema>
  timeline?: z.infer<typeof TimelineSchema>
  condition?: z.infer<typeof ConditionSchema>
  auctionStatus?: z.infer<typeof AuctionStatusSchema>
  smsConsent?: boolean
  hasName?: boolean
  hasPhone?: boolean
  hasEmail?: boolean
  attribution: z.infer<typeof AttributionSchema>
  requestPayload?: Record<string, unknown>
}

async function upsertPpcFormActivity(input: PpcFormActivityInput): Promise<string | null> {
  const metadata = {
    source: input.source,
    form_status: input.formStatus,
    form_submitted: input.formStatus === 'submitted',
    step: input.step,
    address: input.address ?? null,
    address_source: input.addressSource ?? null,
    situation_raw: input.situation ?? null,
    timeline_raw: input.timeline ?? null,
    condition_raw: input.condition ?? null,
    auction_status: input.auctionStatus ?? null,
    situation_tag: input.situation ? SITUATION_TO_TAG[input.situation] : null,
    timeline_urgency: input.timeline ? TIMELINE_TO_URGENCY[input.timeline] : null,
    condition_overall: input.condition ? CONDITION_TO_OVERALL[input.condition] : null,
    sms_consent: input.smsConsent ?? null,
    has_name: input.hasName ?? null,
    has_phone: input.hasPhone ?? null,
    has_email: input.hasEmail ?? null,
    attribution: input.attribution ?? {},
    is_internal: input.requestPayload?.is_internal === true,
    request_context: input.requestPayload ?? null,
  }

  const { data: existing } = await supabase
    .from('lead_activities')
    .select('id')
    .eq('lead_id', input.leadId)
    .eq('metadata->>source', input.source)
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    const { data: updated, error } = await supabase
      .from('lead_activities')
      .update({
        description: input.description,
        metadata,
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle()

    if (error) console.error('[ppc/lead] activity update failed', error)
    return updated?.id ?? existing.id
  }

  const { data, error } = await supabase
    .from('lead_activities')
    .insert({
      lead_id: input.leadId,
      activity_type: 'status_change',
      description: input.description,
      agent: 'System',
      metadata,
    })
    .select('id')
    .single()

  if (error) console.error('[ppc/lead] activity insert failed', error)
  return data?.id ?? null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function triggerPpcLeadSideEffects(params: {
  leadId: string
  fullName: string
  address?: string
  city?: string
  phone: string
  pagePath: string
}) {
  const leadUrl = `/leads/${params.leadId}`
  const publicLeadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'}${leadUrl}`
  const addressPart = params.address ? ` at ${params.address}` : ''
  const alertBody = `New PPC lead: ${params.fullName}${addressPart}. Phone: ${params.phone}. ${publicLeadUrl}`
  const targets = getLeadAlertRecipients()

  const smsResults = process.env.TWILIO_PHONE_NUMBER && targets.length > 0
    ? await Promise.allSettled(
      targets.map((target) =>
        safeSendSMS({
          body: alertBody,
          from: process.env.TWILIO_PHONE_NUMBER!,
          to: target.phone,
        }).then((result) => ({ target: target.name, result })),
      ),
    )
    : []

  await Promise.allSettled([
    notifyNewLead(params.leadId, params.fullName, PPC_SOURCE),
    sendPushToAgents({
      title: 'New PPC lead',
      body: `${params.fullName}${addressPart}`,
      url: leadUrl,
      tag: `ppc-lead-${params.leadId}`,
    }),
    regenerateBriefing(params.leadId, 'ppc_lead_submitted', true),
  ])

  const campaign = ppcCampaignForPagePath(params.pagePath) ?? DEFAULT_PPC_CAMPAIGN
  const callback = await startPpcFormLeadAgentCallback({
    leadId: params.leadId,
    leadPhone: params.phone,
    callerId: campaign.phoneTel,
    fullName: params.fullName,
    address: params.address,
    city: params.city,
    trigger: 'ppc_form_submit',
  })

  await supabase.from('lead_activities').insert({
    lead_id: params.leadId,
    activity_type: 'sms',
    description: alertBody,
    agent: 'System',
    metadata: {
      direction: 'outbound_alert',
      to_agents: targets.map((target) => target.name),
      to_agent_phones: targets.map((target) => target.phone),
      alert_schedule: targets.map((target) => ({
        name: target.name,
        schedule: target.schedule,
      })),
      trigger: 'ppc_lead_alert',
      form_agent_callback: callback,
      delivery_status: smsResults.map((entry) => {
        if (entry.status === 'rejected') {
          return {
            success: false,
            error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason ?? 'Unknown error'),
          }
        }
        return {
          target: entry.value.target,
          success: entry.value.result.success,
          sid: entry.value.result.sid,
          error: entry.value.result.error,
        }
      }),
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof BodySchema>
  try {
    parsed = BodySchema.parse(await req.json())
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? 'Invalid request' : 'Invalid request'
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: corsHeaders })
  }

  const intent = parsed.intent ?? 'submit'
  const address = cleanText(parsed.address) ?? undefined
  const addressSource = parsed.addressSource ?? 'typed'
  const formStep = parsed.step
  const landingPagePath = pagePathFromAttribution(parsed.attribution)
  const requestContext = getPpcRequestContext(req)
  const requestPayload = {
    device: requestContext.devicePayload,
    is_internal: requestContext.isInternal,
    internal_reasons: requestContext.internalReasons,
    landing_page_path: landingPagePath,
  }
  const withRequestPayload = (payload: Record<string, unknown>): Record<string, unknown> => ({
    ...payload,
    ...requestPayload,
  })

  if (intent === 'address_capture') {
    if (!address) return NextResponse.json({ ok: true, deferred: true }, { headers: corsHeaders })

    await recordPpcTrackingEvent({
      eventId: `server:address_typed:${parsed.sessionId ?? parsed.visitorId ?? 'anon'}:${shortHash(`${address}|${addressSource}`)}`,
      eventName: 'address_typed',
      eventCategory: 'form',
      sessionId: parsed.sessionId,
      visitorId: parsed.visitorId,
      pagePath: landingPagePath,
      formStep,
      formStatus: 'address_typed_no_submit',
      situation: parsed.situation,
      timeline: parsed.timeline,
      condition: parsed.condition,
      smsConsent: parsed.smsConsent,
      isTest: requestContext.isInternal,
      attribution: parsed.attribution,
      payload: withRequestPayload({
        source: 'ppc_address_capture',
        form_submitted: false,
        has_address: true,
        address,
        address_source: addressSource,
        address_length: address.length,
      }),
    })

    return NextResponse.json({ ok: true, tracked: true }, { headers: corsHeaders })
  }

  // Pre-contact steps are progress signals only. The final contact step can
  // create a potential lead, then upgrade to autosaved/submitted.
  if (parsed.step < 3 || !parsed.contact) {
    return NextResponse.json({ ok: true, deferred: true }, { headers: corsHeaders })
  }

  const { contact, situation, timeline, condition, auctionStatus, attribution } = parsed
  const smsConsent = parsed.smsConsent ?? true
  const fullName = cleanText(contact.name)
  const phoneE164 = normalizePhoneOrNull(contact.phone)
  const email = normalizeEmailOrNull(contact.email)
  const hasName = Boolean(fullName)
  const hasPhone = Boolean(phoneE164)
  const hasEmail = Boolean(email)
  const hasSubmitFields = Boolean(address && fullName && phoneE164 && email)
  const isInternalTestContact = isInternalTestPhone(phoneE164)
  const suppressSmokeLeadSideEffects = intent === 'submit' && isSmokeMarkedSubmit({
    fullName,
    email,
    phone: phoneE164,
    address,
    sessionId: parsed.sessionId,
    visitorId: parsed.visitorId,
    attribution,
  })
  const isTestLead = requestContext.isInternal || isInternalTestContact || suppressSmokeLeadSideEffects

  if (intent === 'submit' && !hasSubmitFields) {
    return NextResponse.json({ ok: false, error: 'Missing required contact fields' }, { status: 400, headers: corsHeaders })
  }

  if (intent === 'autosave' && !hasSubmitFields) {
    return NextResponse.json({ ok: true, deferred: true }, { headers: corsHeaders })
  }

  if (intent === 'potential' && (!address || (!phoneE164 && !email))) {
    return NextResponse.json({ ok: true, deferred: true }, { headers: corsHeaders })
  }

  if (isInternalTestContact) {
    const eventName = intent === 'autosave'
      ? 'lead_stage3_completed'
      : intent === 'submit'
        ? 'lead_submitted'
        : 'ppc_potential_lead_created'

    await recordPpcTrackingEvent({
      eventId: `server:internal_test_contact:${eventName}:${parsed.sessionId ?? parsed.visitorId ?? 'anon'}:${shortHash(`${phoneE164}|${address ?? ''}|${intent}`)}`,
      eventName,
      eventCategory: intent === 'submit' || intent === 'autosave' ? 'conversion' : 'form',
      sessionId: parsed.sessionId,
      visitorId: parsed.visitorId,
      pagePath: landingPagePath,
      formStep,
      formStatus: intent === 'submit' ? 'internal_test_submit_suppressed' : 'internal_test_contact_suppressed',
      situation,
      timeline,
      condition,
      smsConsent,
      isTest: true,
      attribution,
      payload: withRequestPayload({
        form_submitted: intent === 'submit',
        source: 'ppc_internal_test_contact',
        suppressed_reason: 'internal_test_phone',
        has_address: Boolean(address),
        has_name: hasName,
        has_phone: hasPhone,
        has_email: hasEmail,
        address_source: addressSource,
        auction_status: auctionStatus ?? null,
      }),
    })

    return NextResponse.json({
      ok: true,
      test: true,
      notificationsSkipped: true,
      conversionSuppressed: true,
      manifestId: null,
      leadId: null,
    }, { headers: corsHeaders })
  }

  try {
    // Dedupe by phone -> email -> address (in that order)
    let leadId = await findExistingPpcLeadId({ phone: phoneE164, email, address })

    let cityState: { city?: string; state?: string; zip?: string; county?: string } = {}
    if (address) {
      try {
        const { parseAddressForCounty } = await import('@/lib/county-enrichment')
        const parsed = parseAddressForCounty(address)
        if (parsed) cityState = parsed
      } catch {
        // county enrichment is best-effort
      }
    }

    if (!leadId) {
      const { data: inserted, error } = await supabase
        .from('leads')
        .insert({
          full_name: fullName ?? 'PPC Potential Lead',
          property_address: address ?? null,
          phone: phoneE164,
          email,
          source: PPC_SOURCE,
          station: 'new',
          priority: timeline ? TIMELINE_TO_PRIORITY[timeline] : 'warm',
          ...(cityState.city ? { city: cityState.city } : {}),
          ...(cityState.state ? { state: cityState.state } : {}),
          ...(cityState.zip ? { zip: cityState.zip } : {}),
          ...(cityState.county ? { county: cityState.county } : {}),
        })
        .select('id')
        .single()
      if (error || !inserted?.id) {
        if (error?.code === '23505') {
          leadId = await findExistingPpcLeadId({ phone: phoneE164, email, address })
        }
      }

      if (!leadId && inserted?.id) {
        leadId = inserted.id
      }

      if (!leadId) {
        // Graceful degrade: queue the lead offline so we don't lose it, then
        // return success to the user. The conversion event still fires
        // client-side, the homeowner gets the success state, and we recover
        // the lead from ppc-leads-queue.jsonl once Supabase keys are sorted.
        console.error('[ppc/lead] insert failed — queuing offline', error)
        await queueLeadOffline(parsed, error)
        return NextResponse.json(
          { ok: true, queued: true, manifestId: null, leadId: null },
          { headers: corsHeaders },
        )
      }
    } else {
      // Upgrade the existing lead with the PPC source + any missing fields
      const leadUpdate: Record<string, unknown> = {
        source: PPC_SOURCE,
        ...(fullName ? { full_name: fullName } : {}),
        ...(phoneE164 ? { phone: phoneE164 } : {}),
        ...(email ? { email } : {}),
        ...(address ? { property_address: address } : {}),
        ...(cityState.city ? { city: cityState.city } : {}),
        ...(cityState.state ? { state: cityState.state } : {}),
        ...(cityState.zip ? { zip: cityState.zip } : {}),
        ...(cityState.county ? { county: cityState.county } : {}),
      }
      await supabase
        .from('leads')
        .update(leadUpdate)
        .eq('id', leadId)
    }

    const resolvedLeadId: string = leadId as string
    const manifestId = await ensureManifestExists(resolvedLeadId)
    if (!manifestId) {
      console.error('[ppc/lead] manifest bootstrap failed for lead', resolvedLeadId)
      return NextResponse.json(
        { ok: false, error: 'Manifest unavailable' },
        { status: 500, headers: corsHeaders },
      )
    }

    await updateManifestAndCascade(
      resolvedLeadId,
      (m) => {
        m.source = PPC_SOURCE
        m.leadSource = PPC_SOURCE
        m.priority = timeline ? TIMELINE_TO_PRIORITY[timeline] : 'warm'
        if (situation) {
          const tag = SITUATION_TO_TAG[situation]
          if (!m.situation.type) m.situation.type = []
          if (!m.situation.type.includes(tag)) m.situation.type.push(tag)
        }
        if (timeline) {
          m.situation.timeline = {
            ...(m.situation.timeline ?? {}),
            urgency: TIMELINE_TO_URGENCY[timeline],
            flexibility: timeline === 'flexible' || timeline === 'exploring' ? 'flexible' : 'somewhat_flexible',
          }
        }
        if (condition) {
          m.property.condition = {
            ...(m.property.condition ?? {}),
            overall: CONDITION_TO_OVERALL[condition],
          }
        }
        if (auctionStatus) {
          const auctionFlag = `auction_status_${auctionStatus.replace('-', '_')}`
          m.flags.opportunityFlags = (m.flags.opportunityFlags ?? []).filter(
            (flag) => !flag.startsWith('auction_status_'),
          )
          m.flags.opportunityFlags.push(auctionFlag)
          m.flags.redFlags = (m.flags.redFlags ?? []).filter((flag) => flag !== 'home_sold_at_auction')
          if (auctionStatus === 'yes') {
            m.flags.redFlags.push('home_sold_at_auction')
          }
        }
        if (address && !m.property.address) m.property.address = address
        if (phoneE164 && !m.owner.phones?.includes(phoneE164)) {
          m.owner.phones = [phoneE164, ...(m.owner.phones ?? [])]
        }
        if (email && !m.owner.emails?.includes(email)) {
          m.owner.emails = [email, ...(m.owner.emails ?? [])]
        }
        if (fullName) m.owner.fullName = fullName
        m.acquisition = {
          source: PPC_SOURCE,
          channel: 'google-ads',
          attribution: {
            ...(attribution ?? {}),
            capturedAt: new Date().toISOString(),
          },
        }
      },
      PPC_SOURCE,
    )

    if (intent === 'potential') {
      const activityId = await upsertPpcFormActivity({
        leadId: resolvedLeadId,
        source: 'ppc_form_potential',
        description: 'PPC form captured a potential lead before final submit.',
        formStatus: 'potential_no_submit',
        step: formStep,
        address,
        addressSource,
        situation,
        timeline,
        condition,
        auctionStatus,
        smsConsent,
        hasName,
        hasPhone,
        hasEmail,
        attribution,
        requestPayload,
      })

      await recordPpcTrackingEvent({
        eventId: `server:ppc_potential_lead_created:${resolvedLeadId}:${shortHash(`${address}|${phoneE164 ?? ''}|${email ?? ''}`)}`,
        eventName: 'ppc_potential_lead_created',
        eventCategory: 'form',
        sessionId: parsed.sessionId,
        visitorId: parsed.visitorId,
        leadId: resolvedLeadId,
        manifestId,
        activityId,
        pagePath: landingPagePath,
        formStep,
        formStatus: 'potential_no_submit',
        situation,
        timeline,
        condition,
        phoneNumber: phoneE164 ?? undefined,
        smsConsent,
        isTest: isTestLead,
        attribution,
        payload: withRequestPayload({
          source: 'ppc_form_potential',
          form_submitted: false,
          has_address: Boolean(address),
          has_name: hasName,
          has_phone: hasPhone,
          has_email: hasEmail,
          address,
          address_source: addressSource,
          auction_status: auctionStatus ?? null,
        }),
      })

      return NextResponse.json({
        ok: true,
        potential: true,
        formStatus: 'potential_no_submit',
        manifestId,
        leadId: resolvedLeadId,
      }, { headers: corsHeaders })
    }

    if (intent === 'autosave') {
      const activityId = await upsertPpcFormActivity({
        leadId: resolvedLeadId,
        source: 'ppc_form_autosave',
        description: 'PPC form reached the contact step with all required fields filled; submit was not pressed yet.',
        formStatus: 'stage_3_complete_no_submit',
        step: formStep,
        address,
        addressSource,
        situation,
        timeline,
        condition,
        auctionStatus,
        smsConsent,
        hasName,
        hasPhone,
        hasEmail,
        attribution,
        requestPayload,
      })

      await recordPpcTrackingEvent({
        eventId: `server:lead_stage3_completed:${resolvedLeadId}`,
        eventName: 'lead_stage3_completed',
        eventCategory: 'conversion',
        sessionId: parsed.sessionId,
        visitorId: parsed.visitorId,
        leadId: resolvedLeadId,
        manifestId,
        activityId,
        pagePath: landingPagePath,
        formStep,
        formStatus: 'stage_3_complete_no_submit',
        situation,
        timeline,
        condition,
        smsConsent,
        isTest: isTestLead,
        attribution,
        payload: withRequestPayload({
          form_submitted: false,
          has_address: Boolean(address),
          address,
          address_source: addressSource,
          auction_status: auctionStatus ?? null,
          source: 'ppc_form_autosave',
        }),
      })

      return NextResponse.json({
        ok: true,
        autosaved: true,
        formStatus: 'stage_3_complete_no_submit',
        manifestId,
        leadId: resolvedLeadId,
      }, { headers: corsHeaders })
    }

    const activityId = await upsertPpcFormActivity({
      leadId: resolvedLeadId,
      source: 'ppc_form_submit',
      description: 'PPC form submitted.',
      formStatus: 'submitted',
      step: formStep,
      address,
      addressSource,
      situation,
      timeline,
      condition,
      auctionStatus,
      smsConsent,
      hasName,
      hasPhone,
      hasEmail,
      attribution,
      requestPayload,
    })

    if (!isTestLead) {
      const conversionEventId = `lead:${resolvedLeadId}:lead_submitted`
      await enqueuePpcConversion({
        eventName: 'lead_submitted',
        eventCategory: 'form',
        leadId: resolvedLeadId,
        manifestId,
        activityId,
        dedupeKey: conversionEventId,
        optimizationRole: 'primary',
        conversionValue: 25,
        attribution,
        payload: withRequestPayload({
          openai_ads_event_id: conversionEventId,
          form_status: 'submitted',
          form_submitted: true,
          step: formStep,
          has_address: Boolean(address),
          address_source: addressSource,
          situation_raw: situation ?? null,
          timeline_raw: timeline ?? null,
          condition_raw: condition ?? null,
          auction_status: auctionStatus ?? null,
          sms_consent: smsConsent,
          user_identifiers: buildUserIdentifiers({ email, phone: phoneE164 }),
        }),
      })
    }

    await recordPpcTrackingEvent({
      eventId: `server:lead_submitted:${resolvedLeadId}`,
      eventName: 'lead_submitted',
      eventCategory: 'conversion',
      sessionId: parsed.sessionId,
      visitorId: parsed.visitorId,
      leadId: resolvedLeadId,
      manifestId,
      activityId,
      pagePath: landingPagePath,
      formStep,
      formStatus: 'submitted',
      situation,
      timeline,
      condition,
      smsConsent,
      isTest: isTestLead,
      attribution,
      payload: withRequestPayload({
        form_submitted: true,
        has_address: Boolean(address),
        address,
        address_source: addressSource,
        auction_status: auctionStatus ?? null,
        source: 'ppc_form_submit',
        side_effects_suppressed: isTestLead,
        conversion_suppressed: isTestLead,
        suppressed_reason: isTestLead ? 'internal_or_test_traffic' : null,
      }),
    })

    if (!isTestLead) {
      triggerPpcLeadSideEffects({
        leadId: resolvedLeadId,
        fullName: fullName ?? 'PPC Lead',
        address,
        city: cityState.city,
        phone: phoneE164 ?? '',
        pagePath: landingPagePath,
      }).catch((err) => console.error('[ppc/lead] side effects failed', err))
    }

    return NextResponse.json({
      ok: true,
      manifestId,
      leadId: resolvedLeadId,
      conversionEventId: `lead:${resolvedLeadId}:lead_submitted`,
      ...(isTestLead ? { notificationsSkipped: true, conversionSuppressed: true } : {}),
    }, { headers: corsHeaders })
  } catch (err) {
    console.error('[ppc/lead] unexpected error — queuing offline', err)
    await queueLeadOffline(parsed, err)
    return NextResponse.json({ ok: true, queued: true, manifestId: null, leadId: null }, { headers: corsHeaders })
  }
}
