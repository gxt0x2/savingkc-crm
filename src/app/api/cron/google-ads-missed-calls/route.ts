export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runGoogleAdsMissedCallReconciliation } from '@/lib/google-ads-missed-call-reconciliation'

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const dryRun = parseBool(url.searchParams.get('dryRun'))
  const limit = parsePositiveInt(url.searchParams.get('limit'))

  try {
    const result = await runGoogleAdsMissedCallReconciliation({ dryRun, limit })
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
