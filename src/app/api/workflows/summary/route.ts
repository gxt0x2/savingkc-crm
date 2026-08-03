export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { PHONE_SYSTEM, PHONE_SYSTEM_ATTENTION } from '@/lib/operating-model/phone-system'
import { WORKFLOW_CATALOG } from '@/lib/operating-model/workflow-catalog'

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({
    phones: PHONE_SYSTEM.length,
    phoneAttention: PHONE_SYSTEM_ATTENTION.length,
    workflows: WORKFLOW_CATALOG.length,
    workflowAttention: WORKFLOW_CATALOG.filter((workflow) => workflow.health === 'warning' || workflow.health === 'error').length,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
