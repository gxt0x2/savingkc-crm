export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runPpcConversionExport } from '@/lib/ppc/conversion-exporter'

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
  const validateOnly = parseBool(url.searchParams.get('validateOnly'))
  const batchSize = parsePositiveInt(url.searchParams.get('limit') || url.searchParams.get('batchSize'))

  try {
    const result = await runPpcConversionExport({ dryRun, validateOnly, batchSize })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[ppc-conversion-export] worker failed', error)
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
