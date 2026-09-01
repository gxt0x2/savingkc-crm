export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runPropertyEnrichmentWorker } from '@/lib/server/crm-property-enrichment-jobs'

function requestedLimit(request: Request): number {
  const parsed = Number(new URL(request.url).searchParams.get('limit') || 3)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 5)) : 3
}

async function handle(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await runPropertyEnrichmentWorker(requestedLimit(request))
    if (result.pending > 0 || result.failed > 0) {
      console.error('[property-enrichment-worker] incomplete jobs', {
        claimed: result.claimed,
        completed: result.completed,
        pending: result.pending,
        failed: result.failed,
        errors: Array.from(new Set(result.results.flatMap((item) => item.error ? [item.error] : []))).slice(0, 3),
      })
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[property-enrichment-worker] failed', error)
    return NextResponse.json({ error: 'Property enrichment worker failed.' }, {
      status: 500,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
