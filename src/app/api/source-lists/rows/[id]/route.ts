import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { setSourceListRowStatus } from '@/lib/source-lists/import-source-list'
import { SourceListImportError } from '@/lib/source-lists/csv'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await resolveOauthReviewSandboxLeadId(request)) {
    return NextResponse.json({ error: 'This account cannot update source lists' }, { status: 403 })
  }

  const { id } = await context.params
  try {
    const body = await request.json() as { status?: unknown; statusReason?: unknown; exportBatchId?: unknown }
    const status = typeof body.status === 'string' ? body.status : ''
    const statusReason = typeof body.statusReason === 'string' ? body.statusReason : null
    const exportBatchId = typeof body.exportBatchId === 'string' ? body.exportBatchId : null
    const row = await setSourceListRowStatus(supabaseAdmin(), actor.email, id, status, statusReason, exportBatchId)
    return NextResponse.json({ success: true, ...row })
  } catch (error) {
    if (error instanceof SourceListImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid status request', code: 'invalid_request' }, { status: 400 })
    }
    console.error('[source-lists] status update failed', error)
    return NextResponse.json({ error: 'The source list row could not be updated.', code: 'source_list_unavailable' }, { status: 503 })
  }
}
