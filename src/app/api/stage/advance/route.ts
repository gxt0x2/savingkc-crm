/**
 * ARI CRM - Stage Advancement API
 * Night 3: Pipeline Brain
 *
 * POST /api/stage/advance
 * Body: {
 *   leadId: string,
 *   targetStage: StageId,
 *   changedBy: string,
 *   method?: 'manual_advance' | 'auto_trigger' | 'agent_override',
 *   reason?: string
 * }
 * Returns: { success: boolean, errors: string[] }
 */

import { NextResponse } from 'next/server'
import { advanceLeadStage } from '@/lib/stage-logic'
import type { StageId } from '@/lib/stage-logic'

export async function POST(request: Request) {
  try {
    const { leadId, targetStage, changedBy, method, reason } =
      await request.json()

    if (!leadId || !targetStage || !changedBy) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const result = await advanceLeadStage(
      leadId,
      targetStage as StageId,
      changedBy,
      method || 'manual_advance',
      reason
    )

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          errors: result.errors,
          message: `Cannot advance to ${targetStage}. Missing requirements: ${result.errors.join(', ')}`,
        },
        { status: 400 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Stage advancement error:', error)
    return NextResponse.json(
      { error: 'Failed to advance stage' },
      { status: 500 }
    )
  }
}
