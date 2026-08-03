export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { PHONE_SYSTEM, PHONE_SYSTEM_ATTENTION } from '@/lib/operating-model/phone-system'
import { WORKFLOW_CATALOG } from '@/lib/operating-model/workflow-catalog'
import { readStoredWorkflowDefinitions } from '@/lib/operating-model/workflow-store'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized
  const stored = await readStoredWorkflowDefinitions(supabaseAdmin()).catch(() => [])
  const workflows = [...WORKFLOW_CATALOG, ...stored.map((entry) => entry.definition)]
  return NextResponse.json({
    phones: PHONE_SYSTEM.length,
    phoneAttention: PHONE_SYSTEM_ATTENTION.length,
    workflows: workflows.length,
    workflowAttention: workflows.filter((workflow) => workflow.health === 'warning' || workflow.health === 'error').length,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
