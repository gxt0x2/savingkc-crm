export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { loadLeadJourney } from '@/lib/ppc/lead-journey'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/leads/:id/journey — website/lander journey events for this lead's session.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const result = await loadLeadJourney(supabaseAdmin() as unknown as Parameters<typeof loadLeadJourney>[0], id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
