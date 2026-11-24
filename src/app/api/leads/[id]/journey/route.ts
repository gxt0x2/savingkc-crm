export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { oauthReviewForeignLeadResponse } from '@/lib/auth/oauth-review-sandbox-session'
import { loadLeadCrmTimeline } from '@/lib/ppc/lead-crm-timeline'
import { loadLeadJourney } from '@/lib/ppc/lead-journey'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/leads/:id/journey — website journey events, a summary, and the CRM timeline for this lead.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const hiddenLead = await oauthReviewForeignLeadResponse(id, req)
  if (hiddenLead) return hiddenLead
  const db = supabaseAdmin()
  const result = await loadLeadJourney(db as unknown as Parameters<typeof loadLeadJourney>[0], id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  const crm = await loadLeadCrmTimeline(db, id)
  return NextResponse.json({ ...result, crm }, { headers: { 'Cache-Control': 'no-store' } })
}
