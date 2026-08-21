export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrSecret, requireUserOrSecret } from '@/lib/api/admin-auth'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { WORKFLOW_CATALOG } from '@/lib/operating-model/workflow-catalog'
import {
  WORKFLOW_CATEGORIES,
  buildWorkflowDraft,
  readStoredWorkflowDefinitions,
  saveWorkflowDraft,
  type WorkflowDraftInput,
} from '@/lib/operating-model/workflow-store'

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const stored = await readStoredWorkflowDefinitions(supabaseAdmin())
    return NextResponse.json({
      definitions: [...WORKFLOW_CATALOG, ...stored.map((entry) => entry.definition)],
      stored: stored.map((entry) => ({ id: entry.definition.id, governance: entry.governance })),
      categories: WORKFLOW_CATEGORIES,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workflow registry unavailable' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const actor = await resolveAuthenticatedActor()
    const body = await request.json() as WorkflowDraftInput
    const draft = buildWorkflowDraft(body, actor?.name || 'Authorized automation')
    await saveWorkflowDraft(supabaseAdmin(), draft)
    return NextResponse.json({ definition: draft.definition, governance: draft.governance }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workflow draft could not be created' }, { status: 400 })
  }
}
