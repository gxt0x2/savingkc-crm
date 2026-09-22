export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { oauthReviewForeignLeadResponse } from '@/lib/auth/oauth-review-sandbox-session'
import { buildLeadDispositionCommand, recordLeadDisposition } from '@/lib/server/lead-disposition-command'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Contact id is required' }, { status: 400 })
  const hiddenLead = await oauthReviewForeignLeadResponse(id, req)
  if (hiddenLead) return hiddenLead

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = buildLeadDispositionCommand(body)
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error, code: parsed.code }, { status: 400 })
  }

  try {
    const result = await recordLeadDisposition(id, actor.name, parsed.command)
    return NextResponse.json({
      success: true,
      activityId: result.activityId,
      appointmentId: result.appointmentId,
      ...(result.warning ? { warning: result.warning } : {}),
    }, { status: 201 })
  } catch (error) {
    console.error('[leads/:id/disposition] save failed:', error)
    return NextResponse.json({ success: false, error: 'Call outcome could not be saved' }, { status: 500 })
  }
}
