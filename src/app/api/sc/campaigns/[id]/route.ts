import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { renderMessage, type MergeContext } from '@/lib/smartercontact/spintax'
import type { ScContact } from '@/lib/smartercontact/types'

const RECIPIENT_STATUSES = [
  'pending',
  'sent',
  'delivered',
  'failed',
  'skipped',
  'replied',
] as const

/** Build a fresh status→count map for a campaign's recipients. */
async function recipientBreakdown(
  db: ReturnType<typeof supabaseAdmin>,
  campaignId: string,
): Promise<Record<string, number>> {
  const { data } = await db
    .from('sc_campaign_recipients')
    .select('status')
    .eq('campaign_id', campaignId)
  const counts: Record<string, number> = { total: 0 }
  for (const s of RECIPIENT_STATUSES) counts[s] = 0
  for (const r of data || []) {
    counts[r.status as string] = (counts[r.status as string] || 0) + 1
    counts.total += 1
  }
  return counts
}

/**
 * GET /api/sc/campaigns/[id]
 * Returns the campaign, a recipient status breakdown, and a recent sample.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = supabaseAdmin()

  const { data: campaign, error } = await db
    .from('sc_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const breakdown = await recipientBreakdown(db, id)

  const { data: recent } = await db
    .from('sc_campaign_recipients')
    .select('id, phone, rendered_body, sending_number, status, twilio_sid, error, sent_at')
    .eq('campaign_id', id)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(25)

  return NextResponse.json({ campaign, breakdown, recent: recent || [] })
}

/**
 * Materialize a campaign's recipient rows from its group's active contacts.
 * Idempotent: if recipients already exist, returns the existing count.
 * Suppressed (opted-out) contacts are inserted as status 'skipped'.
 */
async function materialize(
  db: ReturnType<typeof supabaseAdmin>,
  campaign: {
    id: string
    group_id: string | null
    message_body: string | null
  },
): Promise<{ created: number; total: number }> {
  // Idempotency guard: don't duplicate if any recipients exist.
  const { count: existing } = await db
    .from('sc_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
  if (existing && existing > 0) {
    return { created: 0, total: existing }
  }

  if (!campaign.group_id) {
    return { created: 0, total: 0 }
  }

  // Load active contacts in the group (join through membership).
  const { data: members } = await db
    .from('sc_group_members')
    .select('contact_id')
    .eq('group_id', campaign.group_id)
  const contactIds = (members || []).map((m) => m.contact_id).filter(Boolean)
  if (contactIds.length === 0) {
    await db
      .from('sc_campaigns')
      .update({ total_recipients: 0 })
      .eq('id', campaign.id)
    return { created: 0, total: 0 }
  }

  const { data: contacts } = await db
    .from('sc_contacts')
    .select('*')
    .in('id', contactIds as string[])
    .eq('status', 'active')
  const activeContacts = (contacts || []) as ScContact[]

  // One suppression lookup for all phones in play.
  const phones = activeContacts.map((c) => c.phone).filter(Boolean)
  const suppressed = new Set<string>()
  if (phones.length) {
    const { data: optOuts } = await db
      .from('sms_opt_outs')
      .select('phone')
      .in('phone', phones)
      .eq('is_opted_out', true)
    for (const o of optOuts || []) suppressed.add(o.phone)
  }

  const template = campaign.message_body || ''
  const rows = activeContacts
    .filter((c) => c.phone)
    .map((c) => {
      const ctx: MergeContext = {
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        custom_fields: c.custom_fields,
      }
      const isSuppressed = suppressed.has(c.phone)
      return {
        campaign_id: campaign.id,
        contact_id: c.id,
        phone: c.phone,
        rendered_body: renderMessage(template, ctx, c.phone),
        status: isSuppressed ? ('skipped' as const) : ('pending' as const),
        error: isSuppressed ? 'opted_out' : null,
      }
    })

  if (rows.length) {
    const { error: insErr } = await db.from('sc_campaign_recipients').insert(rows)
    if (insErr) throw new Error(`materialize insert: ${insErr.message}`)
  }

  await db
    .from('sc_campaigns')
    .update({ total_recipients: rows.length })
    .eq('id', campaign.id)

  return { created: rows.length, total: rows.length }
}

/**
 * POST /api/sc/campaigns/[id]  { action }
 * Lifecycle actions: materialize | launch | pause | resume | delete.
 * Actual sending is performed by the cron worker; 'launch' just flips the
 * campaign active (after materializing recipients if none exist yet).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = supabaseAdmin()
  const { action } = await req.json().catch(() => ({ action: '' }))

  const { data: campaign, error } = await db
    .from('sc_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  switch (action) {
    case 'materialize': {
      const result = await materialize(db, campaign)
      return NextResponse.json({ success: true, ...result })
    }

    case 'launch': {
      const result = await materialize(db, campaign)
      const { data: updated, error: upErr } = await db
        .from('sc_campaigns')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (upErr)
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      return NextResponse.json({ success: true, campaign: updated, ...result })
    }

    case 'pause': {
      const { data: updated, error: upErr } = await db
        .from('sc_campaigns')
        .update({ status: 'paused' })
        .eq('id', id)
        .select()
        .single()
      if (upErr)
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      return NextResponse.json({ success: true, campaign: updated })
    }

    case 'resume': {
      const { data: updated, error: upErr } = await db
        .from('sc_campaigns')
        .update({ status: 'active' })
        .eq('id', id)
        .select()
        .single()
      if (upErr)
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      return NextResponse.json({ success: true, campaign: updated })
    }

    case 'delete': {
      const { data: updated, error: upErr } = await db
        .from('sc_campaigns')
        .update({ status: 'deleted' })
        .eq('id', id)
        .select()
        .single()
      if (upErr)
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      return NextResponse.json({ success: true, campaign: updated })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
