export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { getTaskProvenanceSummary } from '@/lib/server/task-provenance'

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
    const summary = await getTaskProvenanceSummary()
    return NextResponse.json(summary, {
      headers: {
        ...NO_STORE,
        'Server-Timing': `task-provenance;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    })
  } catch (error) {
    console.error('[task-provenance] read failed', error)
    return NextResponse.json(
      { error: 'Task integrity evidence is unavailable.' },
      { status: 503, headers: NO_STORE },
    )
  }
}
