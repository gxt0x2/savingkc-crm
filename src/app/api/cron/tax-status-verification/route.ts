import { NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { executeTaxStatusBatch, TaxStatusStoreError } from '@/lib/tax-status/persist'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store' }

async function handle(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const summary = await executeTaxStatusBatch(new Date())
    return NextResponse.json({ ok: true, ...summary }, { headers: HEADERS })
  } catch (error) {
    if (error instanceof TaxStatusStoreError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503, headers: HEADERS })
    }
    console.error('[tax-status] verification failed', error)
    return NextResponse.json({ ok: false, error: 'Tax status verification failed' }, { status: 500, headers: HEADERS })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
