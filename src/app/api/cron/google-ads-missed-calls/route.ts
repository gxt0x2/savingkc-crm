export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runGoogleAdsMissedCallReconciliation } from '@/lib/google-ads-missed-call-reconciliation'

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const dryRun = parseBool(url.searchParams.get('dryRun'))
  const rawLookback = Number(url.searchParams.get('twilioLookbackMinutes'))
  const twilioLookbackMinutes = Number.isFinite(rawLookback) && rawLookback > 0
    ? Math.floor(rawLookback)
    : undefined

  try {
    const result = await runGoogleAdsMissedCallReconciliation({ dryRun, twilioLookbackMinutes })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[google-ads-missed-calls] reconciliation failed', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
