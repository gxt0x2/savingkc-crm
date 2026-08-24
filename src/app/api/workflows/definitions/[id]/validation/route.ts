export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  readStoredWorkflowDefinition,
  validateStoredWorkflowDraft,
} from '@/lib/operating-model/workflow-store'

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid workflow identifier.' }, { status: 400, headers: PRIVATE_HEADERS })
  }

  try {
    const stored = await readStoredWorkflowDefinition(supabaseAdmin(), id)
    if (!stored) {
      return NextResponse.json({ error: 'Stored workflow draft not found.' }, { status: 404, headers: PRIVATE_HEADERS })
    }
    return NextResponse.json({ report: validateStoredWorkflowDraft(stored) }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[workflow-validation] failed', error)
    return NextResponse.json({ error: 'Workflow validation is unavailable.' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}
