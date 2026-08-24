import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

/**
 * The legacy reprocessor read recordings from Manifest JSON and silently
 * mutated seller intelligence. It is intentionally unavailable while recorded
 * evidence is moved to the governed call-analysis proposal worker.
 */
export async function POST(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  return NextResponse.json({
    error: 'Legacy Mojo AI reprocessing is retired',
    code: 'mojo_reprocess_retired',
    next: 'Use canonical call evidence and reviewed AI change proposals.',
  }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  })
}
