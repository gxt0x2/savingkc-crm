import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    const body = await req.json().catch(() => null) as { pinned?: unknown } | null
    if (!id || typeof body?.pinned !== 'boolean') {
      return NextResponse.json({ error: 'lead id and pinned boolean are required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const db = supabaseAdmin()
    const { data: current, error: readError } = await db.from('leads').select('id,is_favorite').eq('id', id).maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!current) return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    if (current.is_favorite === body.pinned) {
      return NextResponse.json({ success: true, lead: current }, { headers: mobileNoStoreHeaders() })
    }

    const { data: lead, error } = await db.from('leads').update({ is_favorite: body.pinned, updated_at: new Date().toISOString() }).eq('id', id).select('id,is_favorite').maybeSingle()
    if (error) throw new Error(error.message)
    if (!lead) throw new Error('lead update returned no row')

    const { error: auditError } = await db.from('lead_activities').insert({
      lead_id: id,
      activity_type: 'status_change',
      description: body.pinned ? 'Pinned as a top opportunity' : 'Removed from top opportunities',
      agent: actor.name,
      metadata: { source: 'mobile_app', actor_email: actor.email, mobile_action: 'opportunity_pin', pinned: body.pinned },
    })

    return NextResponse.json({
      success: true,
      lead,
      warning: auditError ? 'Top-opportunity status was saved, but its audit entry could not be written.' : undefined,
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Pinned opportunity could not be updated.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
