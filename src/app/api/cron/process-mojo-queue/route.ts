import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runCanonicalMojoQueueWorker } from '@/lib/server/mojo-call-import'

export const dynamic = 'force-dynamic'

/**
 * Process a bounded batch of canonical Mojo call facts. The database claim is
 * atomic and stale-safe; every derived command has its own idempotency key.
 */
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const requestedLimit = Number(new URL(req.url).searchParams.get('limit') || 5)
    const result = await runCanonicalMojoQueueWorker({
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 5,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[mojo-queue] Worker failed:', error)
    return NextResponse.json(
      { error: 'Mojo import worker unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
