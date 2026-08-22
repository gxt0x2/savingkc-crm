export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { getOperationalReconciliationSnapshot } from '@/lib/server/operational-reconciliation'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET() {
  const startedAt = performance.now()
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) {
    unauthorized.headers.set('Cache-Control', NO_STORE['Cache-Control'])
    unauthorized.headers.set('Vary', NO_STORE.Vary)
    return unauthorized
  }

  try {
    const snapshot = await getOperationalReconciliationSnapshot()
    return NextResponse.json(snapshot, {
      headers: {
        ...NO_STORE,
        'X-Reconciliation-Degraded': String(snapshot.degraded),
        'Server-Timing': `reconciliation;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    })
  } catch (error) {
    console.error('[operational-reconciliation] read failed', error)
    return NextResponse.json(
      { error: 'Operational reconciliation is unavailable.' },
      { status: 503, headers: NO_STORE },
    )
  }
}
