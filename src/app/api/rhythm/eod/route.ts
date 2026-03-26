/**
 * ARI CRM - EOD Reconciliation API
 * Night 3: RHY-02
 *
 * GET /api/rhythm/eod?agentId=... - Get EOD reconciliation data
 */

import { NextResponse } from 'next/server'
import { getEODReconciliation } from '@/lib/operating-rhythm'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId') || 'casey'

    const reconciliation = await getEODReconciliation(agentId)

    return NextResponse.json(reconciliation)
  } catch (error) {
    console.error('EOD reconciliation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate EOD reconciliation' },
      { status: 500 }
    )
  }
}
