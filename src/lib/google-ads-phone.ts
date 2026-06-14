import type { AgentRouting } from '@/lib/agent-routing'
import {
  GOOGLE_ADS_PHONE_NUMBER,
  getGoogleAdsPhoneProfile,
} from '@/lib/call-quality-events'
import { formatPhone } from '@/lib/format'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import { getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect } from '@/lib/prospect-to-lead'
import { getTwilioClient, safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

type ActivityMetadata = Record<string, unknown>

export type GoogleAdsLeadContext = {
  leadId: string | null
  leadName: string | null
  created: boolean
  test?: boolean
}

function profileFor(calledNumber?: string | null) {
  return getGoogleAdsPhoneProfile(calledNumber || GOOGLE_ADS_PHONE_NUMBER)
}

export function googleAdsTeamPhones(_routing?: AgentRouting, now = new Date()): string[] {
  return getLeadAlertRecipients(now).map((recipient) => recipient.phone)
}

export function phoneLookupVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw.trim() ? [raw.trim()] : []

  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const variants = new Set<string>()
  if (national.length === 10) {
    variants.add(`+1${national}`)
    variants.add(national)
    variants.add(`(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`)
  }
  if (raw.trim()) variants.add(raw.trim())
  return Array.from(variants)
}

export function callerPhoneLabel(raw: string): string {
  return formatPhone(raw) || raw
}

export function googleAdsLeadUrl(leadId: string | null | undefined): string {
  return leadId ? `${BASE_URL}/leads/${leadId}` : ''
}

export function googleAdsNewCallTeamMessage(from: string, leadId?: string | null, calledNumber?: string | null): string {
  const profile = profileFor(calledNumber)
  const leadUrl = googleAdsLeadUrl(leadId)
  return `NEW ${profile.label.toUpperCase()} CALL from ${callerPhoneLabel(from)}${leadUrl ? `\n${leadUrl}` : ''}`
}

export function googleAdsNewTextTeamMessage(from: string, body: string, leadId?: string | null, calledNumber?: string | null): string {
  const profile = profileFor(calledNumber)
  const leadUrl = googleAdsLeadUrl(leadId)
  return `NEW ${profile.label.toUpperCase()} TEXT from ${callerPhoneLabel(from)}: "${body.slice(0, 120)}"${leadUrl ? `\n${leadUrl}` : ''}`
}

export function googleAdsMissedCallerMessage(calledNumber?: string | null): string {
  if (profileFor(calledNumber).key === 'tax') {
    return "Hey, this is Saving KC Homebuyers. Sorry we missed your call about property taxes. Are you looking to sell the property? Reply here and we'll help."
  }
  return "Hey, this is Saving KC Homebuyers. Sorry we missed your call. Are you looking to sell a property? Reply here and we'll help."
}

export function googleAdsEscalationReminderMessage(from: string, leadId?: string | null, calledNumber?: string | null): string {
  const profile = profileFor(calledNumber)
  const leadUrl = googleAdsLeadUrl(leadId)
  return `REMINDER: ${profile.label} call from ${callerPhoneLabel(from)} still needs a callback. Starting agent callback now.${leadUrl ? `\n${leadUrl}` : ''}`
}

export function googleAdsAttribution(capturedAt = new Date().toISOString(), calledNumber?: string | null): Record<string, unknown> {
  const profile = profileFor(calledNumber)
  return {
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: profile.campaign,
    tracking_number: profile.trackingDigits,
    source: profile.source,
    landing_page: profile.landingPage,
    phone_profile: profile.key,
    capturedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canCreateLeadFromCallerPhone(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  return Boolean(normalized && !normalized.includes('anonymous') && !normalized.includes('blocked'))
}

async function updateLeadSource(leadId: string, calledNumber?: string | null): Promise<void> {
  const profile = profileFor(calledNumber)
  const { error } = await supabase
    .from('leads')
    .update({ source: profile.source, priority: 'hot' })
    .eq('id', leadId)

  if (error) {
    console.error(`[GOOGLE-ADS-PHONE] Failed to set ${profile.source} source:`, error)
  }
}

export async function markLeadAsGoogleAdsPhoneLead(leadId: string, from: string, name?: string | null, calledNumber?: string | null): Promise<void> {
  if (isInternalTestPhone(from)) return

  const profile = profileFor(calledNumber)
  await updateLeadSource(leadId, calledNumber)

  try {
    const manifestId = await ensureManifestExists(leadId)
    if (!manifestId) return

    await updateManifestAndCascade(
      leadId,
      (manifest) => {
        const mutable = manifest as unknown as Record<string, unknown>
        const owner = isRecord(mutable.owner) ? mutable.owner : {}
        const existingPhones = Array.isArray(owner.phones) ? owner.phones.filter((phone): phone is string => typeof phone === 'string') : []

        mutable.source = profile.source
        mutable.leadSource = profile.source
        mutable.priority = 'hot'
        mutable.owner = {
          ...owner,
          phones: existingPhones.includes(from) ? existingPhones : [from, ...existingPhones],
          fullName: typeof owner.fullName === 'string' && owner.fullName.trim()
            ? owner.fullName
            : name || `${profile.label} Caller ${callerPhoneLabel(from)}`,
        }

        const acquisition = isRecord(mutable.acquisition) ? mutable.acquisition : {}
        const priorAttribution = isRecord(acquisition.attribution) ? acquisition.attribution : {}
        mutable.acquisition = {
          ...acquisition,
          source: profile.source,
          channel: 'google-ads',
          attribution: {
            ...priorAttribution,
            ...googleAdsAttribution(new Date().toISOString(), calledNumber),
          },
        }
      },
      'google-ads-phone',
    )
  } catch (error) {
    console.error('[GOOGLE-ADS-PHONE] Manifest bootstrap failed:', error)
  }
}

async function findExistingLeadByPhone(phone: string): Promise<{ id: string; full_name: string | null } | null> {
  for (const variant of phoneLookupVariants(phone)) {
    const { data } = await supabase
      .from('leads')
      .select('id, full_name')
      .eq('phone', variant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data?.id) return { id: data.id, full_name: data.full_name || null }
  }

  return null
}

async function createGoogleAdsLeadFromProspect(phone: string, calledNumber?: string | null): Promise<GoogleAdsLeadContext | null> {
  const profile = profileFor(calledNumber)
  for (const variant of phoneLookupVariants(phone)) {
    const prospectMatches = await lookupProspectByPhone(variant)
    const prospectMatch = prospectMatches[0]
    if (!prospectMatch) continue

    const leadId = await createEnrichedLeadFromProspect(prospectMatch, phone, 'inbound_call', 'hot')
    if (!leadId) continue

    const leadName = prospectMatch.owner_1 || `${profile.label} Caller ${callerPhoneLabel(phone)}`
    await markLeadAsGoogleAdsPhoneLead(leadId, phone, leadName, calledNumber)
    return { leadId, leadName, created: !prospectMatch.lead_id }
  }

  return null
}

export async function resolveGoogleAdsLeadContext(phone: string, calledNumber?: string | null): Promise<GoogleAdsLeadContext> {
  if (isInternalTestPhone(phone)) {
    return { leadId: null, leadName: 'Internal Google Voice Test', created: false, test: true }
  }

  const profile = profileFor(calledNumber)
  const existingLead = await findExistingLeadByPhone(phone)
  if (existingLead?.id) {
    await markLeadAsGoogleAdsPhoneLead(existingLead.id, phone, existingLead.full_name, calledNumber)
    return { leadId: existingLead.id, leadName: existingLead.full_name, created: false }
  }

  const prospectLead = await createGoogleAdsLeadFromProspect(phone, calledNumber)
  if (prospectLead) return prospectLead

  if (!canCreateLeadFromCallerPhone(phone)) {
    return { leadId: null, leadName: null, created: false }
  }

  const fullName = `${profile.label} Caller ${callerPhoneLabel(phone)}`
  const { data, error } = await supabase
    .from('leads')
    .insert({
      full_name: fullName,
      phone,
      source: profile.source,
      station: 'new',
      priority: 'hot',
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    console.error('[GOOGLE-ADS-PHONE] Lead insert failed:', error)
    return { leadId: null, leadName: null, created: false }
  }

  await markLeadAsGoogleAdsPhoneLead(data.id, phone, fullName, calledNumber)
  return { leadId: data.id, leadName: fullName, created: true }
}

export async function notifyGoogleAdsTeam(
  body: string,
  options: {
    leadId?: string | null
    routing?: AgentRouting
    trigger: string
    calledNumber?: string | null
    now?: Date
    metadata?: ActivityMetadata
  },
): Promise<void> {
  const from = typeof options.metadata?.from === 'string' ? options.metadata.from : ''
  if (isInternalTestPhone(from)) return

  const metadataCalledNumber = typeof options.metadata?.calledNumber === 'string'
    ? options.metadata.calledNumber
    : typeof options.metadata?.to === 'string'
      ? options.metadata.to
      : null
  const profile = profileFor(options.calledNumber || metadataCalledNumber)
  const recipients = getLeadAlertRecipients(options.now)
  const teamPhones = recipients.map((recipient) => recipient.phone)
  const results = await Promise.allSettled(
    teamPhones.map((to) => safeSendSMS({ body, from: TWILIO_PHONE, to })),
  )

  if (options.leadId) {
    await supabase.from('lead_activities').insert({
      lead_id: options.leadId,
      activity_type: 'sms',
      description: body,
      agent: 'System',
      metadata: {
        direction: 'outbound_alert',
        trigger: options.trigger,
        source: profile.source,
        traffic_source: 'google_ads',
        campaign: profile.campaign,
        tracking_number: profile.trackingDigits,
        landing_page: profile.landingPage,
        phone_profile: profile.key,
        to_agents: recipients.map((recipient) => recipient.name),
        to_agent_phones: teamPhones,
        alert_schedule: recipients.map((recipient) => ({
          name: recipient.name,
          schedule: recipient.schedule,
        })),
        delivery_status: results.map((result, index) => ({
          to: teamPhones[index],
          status: result.status,
          value: result.status === 'fulfilled' ? result.value : undefined,
          reason: result.status === 'rejected' ? String(result.reason) : undefined,
        })),
        ...options.metadata,
      },
    })
  }
}

export async function createGoogleAdsMissedEscalationTask(input: {
  leadId: string
  from: string
  calledNumber: string
  callSid: string
  dialCallSid: string
  dialCallDuration: number | null
  routing: AgentRouting
}): Promise<{ taskId: string | null; dueDate: string; missedAt: string; metadata: Record<string, unknown> }> {
  const profile = profileFor(input.calledNumber)
  const dueDate = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const missedAt = new Date().toISOString()
  const isTest = isInternalTestPhone(input.from)
  const metadata = {
    task_type: 'google_ads_missed_call_escalation',
    source: profile.source,
    traffic_source: 'google_ads',
    campaign: profile.campaign,
    tracking_number: profile.trackingDigits,
    landing_page: profile.landingPage,
    phone_profile: profile.key,
    due_date: dueDate,
    missed_at: missedAt,
    status: isTest ? 'skipped' : 'pending',
    priority: 'critical',
    is_test: isTest,
    skipped_reason: isTest ? 'internal_test_phone' : undefined,
    seller_phone: input.from,
    called_number: input.calledNumber || profile.number,
    callSid: input.callSid,
    dialCallSid: input.dialCallSid,
    dialCallDuration: input.dialCallDuration,
    assigned_to: input.routing.primary.name,
    primary_agent_name: input.routing.primary.name,
    primary_agent_phone: input.routing.primary.phone,
    secondary_agent_name: input.routing.secondary.name,
    secondary_agent_phone: input.routing.secondary.phone,
  }

  if (isTest) {
    return { taskId: null, dueDate, missedAt, metadata }
  }

  const { data, error } = await supabase.from('lead_activities').insert({
    lead_id: input.leadId,
    activity_type: 'task',
    description: `${profile.label} missed call escalation for ${callerPhoneLabel(input.from)}`,
    agent: 'Ari',
    metadata,
  }).select('id').single()

  if (error) {
    console.error('[GOOGLE-ADS-PHONE] Failed to create missed escalation task:', error)
  }

  return { taskId: data?.id || null, dueDate, missedAt, metadata }
}

export async function hasGoogleAdsLeadRespondedSince(leadId: string, sinceIso: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id, activity_type, metadata, created_at')
    .eq('lead_id', leadId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[GOOGLE-ADS-PHONE] Response check failed:', error)
    return false
  }

  return (data || []).some((activity) => {
    const metadata = isRecord(activity.metadata) ? activity.metadata : {}
    const direction = typeof metadata.direction === 'string' ? metadata.direction.toLowerCase() : ''
    const outcome = typeof metadata.outcome === 'string' ? metadata.outcome.toLowerCase() : ''
    const status = typeof metadata.status === 'string' ? metadata.status.toLowerCase() : ''
    const dialStatus = typeof metadata.dialStatus === 'string' ? metadata.dialStatus.toLowerCase() : ''

    if (activity.activity_type === 'sms' && ['received', 'inbound'].includes(direction)) return true
    if (activity.activity_type === 'call' && ['connected', 'completed', 'answered'].includes(outcome || status || dialStatus)) return true

    return false
  })
}

export async function startGoogleAdsAgentCallback(input: {
  leadId: string
  leadPhone: string
  calledNumber: string
  agentName: string
  agentPhone: string
  triggerCallSid?: string
}): Promise<{ started: boolean; sid?: string; error?: string }> {
  const client = getTwilioClient()
  if (!client) {
    return { started: false, error: 'Twilio client not initialized' }
  }

  const callbackUrl = new URL('/api/ivr/google-ads-agent-callback', BASE_URL)
  callbackUrl.searchParams.set('leadId', input.leadId)
  callbackUrl.searchParams.set('leadPhone', input.leadPhone)
  callbackUrl.searchParams.set('calledNumber', input.calledNumber || GOOGLE_ADS_PHONE_NUMBER)
  callbackUrl.searchParams.set('agentName', input.agentName)
  callbackUrl.searchParams.set('agentPhone', input.agentPhone)
  if (input.triggerCallSid) callbackUrl.searchParams.set('triggerCallSid', input.triggerCallSid)

  try {
    const call = await client.calls.create({
      to: input.agentPhone,
      from: input.calledNumber || GOOGLE_ADS_PHONE_NUMBER,
      url: callbackUrl.toString(),
      method: 'POST',
      timeout: 20,
    })

    return { started: true, sid: call.sid }
  } catch (error) {
    console.error('[GOOGLE-ADS-PHONE] Agent callback failed:', error)
    return { started: false, error: error instanceof Error ? error.message : 'Unknown Twilio error' }
  }
}
