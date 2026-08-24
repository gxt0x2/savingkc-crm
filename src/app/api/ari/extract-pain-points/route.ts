import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'

export const dynamic = 'force-dynamic'

export async function POST() {
  const unauthorized = await requireAuthenticatedUser({ error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  return NextResponse.json({
    error: 'Standalone pain-point extraction was replaced by the unified, governed AI Assistant.',
    code: 'ari_pain_point_extraction_retired',
    replacement: '/api/ai/command',
  }, {
    status: 410,
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
  })
}
