export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { updateManifestAndCascade } from '@/lib/manifest-sync'

const ALLOWED_STATIONS = new Set([
  // Legacy + canonical (accept both pre/post #121)
  'intake', 'not_contacted', 'new',
  'attempting_contact', 'contacted',
  'qualifying', 'qualified', 'discovery',
  'appointment', 'appt_set', 'appointment_set',
  'offer', 'offer_prep', 'offer_made', 'offer_presented', 'negotiating', 'negotiations',
  'contract', 'contract_signed', 'under_contract',
  'inspection', 'closing_prep', 'closing',
  'closed', 'closed_won', 'closed_lost',
  'nurture', 'disposition', 'dead',
])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()

  // Fetch lead + manifest in parallel
  const [leadRes, manifestRes] = await Promise.all([
    db.from('leads')
      .select('*')
      .eq('id', id)
      .single(),
    db.from('manifests')
      .select('manifest')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lead = leadRes.data as any
  return NextResponse.json({
    ...lead,
    manifest: (manifestRes.data as any)?.manifest?.manifest ?? null,
  })
}

/**
 * PATCH /api/leads/[id]
 *
 * Admin-only structured updates. Currently supports `station` (canonical
 * pipeline advance/move). Cascades through manifest so scoring, briefings,
 * and audit trail stay coherent.
 *
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET, or signed-in admin.
 *
 * Body: { station?: string, reason?: string }
 *
 * Why this endpoint: bulk station correction (e.g. moving a contract-signed
 * lead from `intake` to `under_contract` because no one advanced it in the
 * UI) needs a programmatic path. The dialer disposition modal also writes
 * station, but it's tightly coupled to call events — not appropriate for
 * out-of-band corrections.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { station?: string; reason?: string }

  if (!body.station) {
    return NextResponse.json({ error: 'body.station required' }, { status: 400 })
  }
  if (!ALLOWED_STATIONS.has(body.station)) {
    return NextResponse.json(
      { error: `invalid station "${body.station}"`, allowed: [...ALLOWED_STATIONS] },
      { status: 400 },
    )
  }

  const db = supabaseAdmin()

  const { data: lead } = await db
    .from('leads')
    .select('id, station, full_name')
    .eq('id', id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const prevStation = lead.station

  // 1. Update the leads row
  const { error: updErr } = await db
    .from('leads')
    .update({ station: body.station, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // 2. Cascade through manifest so scoring + audit trail stay coherent.
  const cascadeOk = await updateManifestAndCascade(id, (manifest) => {
    manifest.currentStation = body.station as string
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:admin_patch_station',
      action: 'station_changed_admin',
      details: { from: prevStation, to: body.station, reason: body.reason ?? null },
    })
  }, 'admin_patch_station').catch(() => false)

  return NextResponse.json({
    ok: true,
    leadId: id,
    fullName: lead.full_name,
    from: prevStation,
    to: body.station,
    cascaded: cascadeOk,
  })
}
