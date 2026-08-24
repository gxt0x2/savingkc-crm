export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { supabase } from '@/lib/supabase-lazy'

const PILLARS = ['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'] as const
type Pillar = (typeof PILLARS)[number]

type QualificationRow = {
  pillar: Pillar
  evidence: string
  status: 'needs_review' | 'verified'
  source_type: 'operator' | 'legacy_manifest' | 'imported'
  verified_by_name: string | null
  verified_at: string | null
}

function noStoreHeaders() {
  return { 'Cache-Control': 'private, no-store, max-age=0' }
}

function responseRows(rows: QualificationRow[]) {
  const byPillar = new Map(rows.map((row) => [row.pillar, row]))
  const pillars = PILLARS.map((pillar) => {
    const row = byPillar.get(pillar)
    return {
      pillar,
      evidence: row?.evidence ?? '',
      status: row?.status ?? 'missing',
      sourceType: row?.source_type ?? null,
      verifiedBy: row?.verified_by_name ?? null,
      verifiedAt: row?.verified_at ?? null,
    }
  })
  return {
    pillars,
    complete: pillars.every((pillar) => pillar.status === 'verified'),
    verifiedCount: pillars.filter((pillar) => pillar.status === 'verified').length,
  }
}

async function readQualification(leadId: string) {
  const { data, error } = await supabase
    .from('crm_lead_qualification_pillars')
    .select('pillar,evidence,status,source_type,verified_by_name,verified_at')
    .eq('lead_id', leadId)
  if (error) throw new Error(error.message)
  return responseRows((data ?? []) as QualificationRow[])
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders() })

  const { id } = await params
  try {
    return NextResponse.json(await readQualification(id), { headers: noStoreHeaders() })
  } catch (error) {
    console.error('[qualification] read failed', error)
    return NextResponse.json({ error: 'Qualification records are unavailable' }, { status: 503, headers: noStoreHeaders() })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders() })

  const { id } = await params
  const body = await req.json().catch(() => null) as { pillars?: Record<string, unknown> } | null
  if (!body?.pillars || typeof body.pillars !== 'object' || Array.isArray(body.pillars)) {
    return NextResponse.json({ error: 'Provide qualification pillars' }, { status: 400, headers: noStoreHeaders() })
  }

  const pillars: Partial<Record<Pillar, string>> = {}
  for (const pillar of PILLARS) {
    const raw = body.pillars[pillar]
    if (raw === undefined) continue
    if (typeof raw !== 'string' || !raw.trim()) {
      return NextResponse.json({ error: `${pillar} evidence cannot be empty` }, { status: 400, headers: noStoreHeaders() })
    }
    if (raw.trim().length > 2000) {
      return NextResponse.json({ error: `${pillar} evidence is too long` }, { status: 400, headers: noStoreHeaders() })
    }
    pillars[pillar] = raw.trim()
  }
  if (Object.keys(pillars).length === 0) {
    return NextResponse.json({ error: 'Provide at least one qualification pillar' }, { status: 400, headers: noStoreHeaders() })
  }

  try {
    const { error } = await supabase.rpc('save_crm_lead_qualification_v1', {
      p_lead_id: id,
      p_pillars: pillars,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
    })
    if (error) throw new Error(error.message)
    return NextResponse.json(await readQualification(id), { headers: noStoreHeaders() })
  } catch (error) {
    console.error('[qualification] save failed', error)
    return NextResponse.json({ error: 'Qualification evidence could not be saved' }, { status: 503, headers: noStoreHeaders() })
  }
}
