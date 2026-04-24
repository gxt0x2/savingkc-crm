export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSubmitterInvite } from '@/lib/docuseal'

// POST /api/offers/[id]/assignment/send
// Triggers the invitation email for the Assignee submitter on an existing
// DocuSeal submission created by POST /api/offers/[id]/assignment.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const db = supabaseAdmin()

    const { data: offer } = await db
      .from('buyer_offers')
      .select('id, assignment_submission_id, assignment_assignee_submitter_id, assignment_sent_at')
      .eq('id', id)
      .single()
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    if (!offer.assignment_submission_id || !offer.assignment_assignee_submitter_id) {
      return NextResponse.json(
        { error: 'No assignment submission to send — create the preview first' },
        { status: 400 }
      )
    }
    if (offer.assignment_sent_at) {
      return NextResponse.json({ ok: true, alreadySent: true })
    }

    await sendSubmitterInvite(offer.assignment_assignee_submitter_id)

    const now = new Date().toISOString()
    await db.from('buyer_offers').update({ assignment_sent_at: now }).eq('id', id)

    return NextResponse.json({ ok: true, sentAt: now })
  } catch (err) {
    console.error('[assignment/send POST] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
