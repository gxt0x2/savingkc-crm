import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
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
    referrer: z.string().max(500).optional(),
    landingUrl: z.string().max(500).optional(),
  })
  .optional()

const BodySchema = z.object({
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  // Steps 1 and 2 are progress signals — conversions fire client-side, no
  // server-side write yet. We could persist partial state to a separate
  // ppc_partial_leads table in the future for re-engagement campaigns.
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
        // Keep a local emergency record for debugging/replay, but do not
        // report success. Paid conversions must represent durable CRM writes.
        console.error('[ppc/lead] insert failed — queuing offline', error)
        await queueLeadOffline(parsed, error)
        return NextResponse.json(
          { ok: false, queued: true, error: 'Lead could not be saved. Please call us so we do not miss you.' },
          { status: 503, headers: corsHeaders },
        )
      }
      leadId = inserted.id
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
