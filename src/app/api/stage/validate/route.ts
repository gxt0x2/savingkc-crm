/**
 * ARI CRM - Stage Validation API
 * Night 3: Pipeline Brain
 *
 * POST /api/stage/validate
 * Body: { leadId: string, targetStage: StageId }
 * Returns: { valid: boolean, missing: string[], warnings: string[] }
 */

import { NextResponse } from 'next/server'
import { validateLeadStage } from '@/lib/stage-logic'
import type { StageId } from '@/lib/stage-logic'

export async function POST(request: Request) {
  try {
    const { leadId, targetStage } = await request.json()

    if (!leadId || !targetStage) {
      return NextResponse.json(
        { error: 'Missing leadId or targetStage' },
        { status: 400 }
      )
    }

    const validation = await validateLeadStage(leadId, targetStage as StageId)

    return NextResponse.json(validation)
  } catch (error) {
    console.error('Stage validation error:', error)
    return NextResponse.json(
      { error: 'Failed to validate stage' },
      { status: 500 }
    )
  }
}
