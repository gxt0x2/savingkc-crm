export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { getLifecycleReconciliationSnapshot } from '@/lib/server/lifecycle-reconciliation'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET() {
  const startedAt = performance.now()
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) return unauthorized
  try {
    const snapshot = await getLifecycleReconciliationSnapshot()
    return NextResponse.json(snapshot, {
      headers: { ...NO_STORE, 'Server-Timing': `lifecycle-reconciliation;dur=${(performance.now() - startedAt).toFixed(1)}` },
    })
  } catch (error) {
    console.error('[lifecycle-reconciliation] read failed', error)
    return NextResponse.json({ error: 'Lifecycle evidence review is unavailable.' }, { status: 503, headers: NO_STORE })
  }
}
