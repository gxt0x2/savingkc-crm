import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { notifyNewLead } from '@/lib/ari-briefing'
import { regenerateBriefing } from '@/lib/briefing-regen'
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
const CRM_LEAD_SOURCE = 'website_form'
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

const AttributionSchema = z
  .object({
    utm_source: z.string().max(120).optional(),
    utm_medium: z.string().max(120).optional(),
    utm_campaign: z.string().max(180).optional(),
    utm_term: z.string().max(180).optional(),
    utm_content: z.string().max(180).optional(),
    gclid: z.string().max(180).optional(),
    gbraid: z.string().max(180).optional(),
    wbraid: z.string().max(180).optional(),
    gad_source: z.string().max(120).optional(),
    gad_campaignid: z.string().max(180).optional(),
    gad_adgroupid: z.string().max(180).optional(),
    referrer: z.string().max(500).optional(),
    landingUrl: z.string().max(500).optional(),
  })
  .optional()

const BodySchema = z.object({
  intent: z.enum(['autosave', 'submit']).optional(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  address: z.string().min(3).max(200).optional(),
  situation: SituationSchema.optional(),
  timeline: TimelineSchema.optional(),
  condition: ConditionSchema.optional(),
  contact: z
    .object({
      name: z.string().min(1).max(120),
      phone: z.string().min(10).max(20),
      email: z.string().email().max(200),
    })
    .optional(),
  attribution: AttributionSchema,
})

const SITUATION_TO_TAG: Record<z.infer<typeof SituationSchema>, string> = {
  'tax-delinquent': 'tax_delinquent',
  inherited: 'inherited',
  'tired-landlord': 'tired_landlord',
  condition: 'distressed_condition',
  'life-event': 'life_event',
  other: 'ppc_other',
}

const TIMELINE_TO_URGENCY: Record<z.infer<typeof TimelineSchema>, 'critical' | 'high' | 'medium' | 'low'> = {
  asap: 'critical',
  '60-days': 'high',
  flexible: 'medium',
  exploring: 'low',
}

const TIMELINE_TO_PRIORITY: Record<z.infer<typeof TimelineSchema>, 'hot' | 'warm'> = {
  asap: 'hot',
  '60-days': 'warm',
  flexible: 'warm',
  exploring: 'warm',
}

const CONDITION_TO_OVERALL: Record<z.infer<typeof ConditionSchema>, 'good' | 'fair' | 'poor' | 'uninhabitable'> = {
  good: 'good',
  'needs-work': 'fair',
  'major-repair': 'poor',
  vacant: 'poor',
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

async function findExistingPpcLeadId({
  phone,
  email,
  address,
}: {
  phone: string
  email: string
  address?: string
}): Promise<string | null> {
  if (!address) return null

  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('source', CRM_LEAD_SOURCE)
    .eq('phone', phone)
    .eq('email', email)
    .eq('property_address', address)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

type PpcFormActivityInput = {
  leadId: string
  source: 'ppc_form_autosave' | 'ppc_form_submit'
  description: string
  formStatus: 'stage_3_complete_no_submit' | 'submitted'
  step: number
  address?: string
  attribution: z.infer<typeof AttributionSchema>
}

async function upsertPpcFormActivity(input: PpcFormActivityInput): Promise<string | null> {
  const metadata = {
    source: input.source,
    form_status: input.formStatus,
    form_submitted: input.formStatus === 'submitted',
    step: input.step,
    address: input.address ?? null,
    attribution: input.attribution ?? {},
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
  phone: string
}) {
  const leadUrl = `/leads/${params.leadId}`
  const publicLeadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'}${leadUrl}`
  const addressPart = params.address ? ` at ${params.address}` : ''
  const alertBody = `New PPC lead: ${params.fullName}${addressPart}. Phone: ${params.phone}. ${publicLeadUrl}`
  const targets = [
    { name: 'Casey', phone: process.env.CASEY_PHONE },
    { name: 'Ernest', phone: process.env.ERNEST_PHONE },
  ].filter((target): target is { name: string; phone: string } => Boolean(target.phone))

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

  await supabase.from('lead_activities').insert({
    lead_id: params.leadId,
    activity_type: 'sms',
    description: alertBody,
    agent: 'System',
    metadata: {
      direction: 'outbound_alert',
      to_agents: targets.map((target) => target.name),
      trigger: 'ppc_lead_alert',
      delivery_status: smsResults.map((entry) => {
        if (entry.status === 'rejected') return { success: false, error: entry.reason?.message || 'Unknown error' }
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

  // Steps 1 and 2 are progress signals only. Stage 3 can autosave once all
  // required contact fields are present, but it is not counted as submitted.
  if (parsed.step < 3 || !parsed.contact) {
    return NextResponse.json({ ok: true, deferred: true }, { headers: corsHeaders })
  }

  const { contact, address, situation, timeline, condition, attribution } = parsed
  const fullName = contact.name.trim()
  const phoneE164 = normalizePhone(contact.phone)
  const email = contact.email.trim().toLowerCase()
  const ppcPriority = timeline ? TIMELINE_TO_PRIORITY[timeline] : 'warm'

  try {
    // Dedupe by phone -> email -> address (in that order)
    let leadId: string | null = null

    const { data: byPhone } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phoneE164)
      .limit(1)
      .maybeSingle()
    if (byPhone?.id) leadId = byPhone.id

    if (!leadId && email) {
      const { data: byEmail } = await supabase
        .from('leads')
        .select('id')
        .eq('email', email)
        .limit(1)
        .maybeSingle()
      if (byEmail?.id) leadId = byEmail.id
    }

    if (!leadId && address) {
      const { data: byAddress } = await supabase
        .from('leads')
        .select('id')
        .eq('property_address', address)
        .limit(1)
        .maybeSingle()
      if (byAddress?.id) leadId = byAddress.id
    }

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
          full_name: fullName,
          property_address: address ?? null,
          phone: phoneE164,
          email,
          source: CRM_LEAD_SOURCE,
          station: 'new',
          priority: ppcPriority,
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
        console.error('[ppc/lead] insert failed — queuing offline', error)
        await queueLeadOffline(parsed, error)
        return NextResponse.json(
          { ok: false, queued: true, error: 'Lead could not be saved. Please call us so we do not miss you.' },
          { status: 503, headers: corsHeaders },
        )
      }
    } else {
      // Upgrade the existing lead with the PPC source + any missing fields
      await supabase
        .from('leads')
        .update({
          source: CRM_LEAD_SOURCE,
          full_name: fullName,
          phone: phoneE164,
          email,
          ...(address ? { property_address: address } : {}),
          ...(cityState.city ? { city: cityState.city } : {}),
          ...(cityState.state ? { state: cityState.state } : {}),
          ...(cityState.zip ? { zip: cityState.zip } : {}),
          ...(cityState.county ? { county: cityState.county } : {}),
        })
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
        m.priority = ppcPriority
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
        if (address && !m.property.address) m.property.address = address
        if (!m.owner.phones?.includes(phoneE164)) {
          m.owner.phones = [phoneE164, ...(m.owner.phones ?? [])]
        }
        if (!m.owner.emails?.includes(email)) {
          m.owner.emails = [email, ...(m.owner.emails ?? [])]
        }
        m.owner.fullName = fullName
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

    if (intent === 'autosave') {
      const activityId = await upsertPpcFormActivity({
        leadId: resolvedLeadId,
        source: 'ppc_form_autosave',
        description: 'PPC form reached step 3 with all required fields filled; submit was not pressed yet.',
        formStatus: 'stage_3_complete_no_submit',
        step: 3,
        address,
        attribution,
      })

      await enqueuePpcConversion({
        eventName: 'lead_stage3_completed',
        eventCategory: 'form',
        leadId: resolvedLeadId,
        manifestId,
        activityId,
        dedupeKey: `lead:${resolvedLeadId}:lead_stage3_completed`,
        optimizationRole: 'secondary',
        conversionValue: 10,
        attribution,
        payload: {
          form_status: 'stage_3_complete_no_submit',
          form_submitted: false,
          step: 3,
          address: address ?? null,
        },
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
      step: 3,
      address,
      attribution,
    })

    await enqueuePpcConversion({
      eventName: 'lead_submitted',
      eventCategory: 'form',
      leadId: resolvedLeadId,
      manifestId,
      activityId,
      dedupeKey: `lead:${resolvedLeadId}:lead_submitted`,
      optimizationRole: 'primary',
      conversionValue: 25,
      attribution,
      payload: {
        form_status: 'submitted',
        form_submitted: true,
        step: 3,
        address: address ?? null,
      },
    })

    triggerPpcLeadSideEffects({
      leadId: resolvedLeadId,
      fullName,
      address,
      phone: phoneE164,
    }).catch((err) => console.error('[ppc/lead] side effects failed', err))

    return NextResponse.json({ ok: true, manifestId, leadId: resolvedLeadId }, { headers: corsHeaders })
  } catch (err) {
    console.error('[ppc/lead] unexpected error — queuing offline', err)
    await queueLeadOffline(parsed, err)
    return NextResponse.json(
      { ok: false, queued: true, error: 'Lead could not be saved. Please call us so we do not miss you.' },
      { status: 500, headers: corsHeaders },
    )
  }
}
