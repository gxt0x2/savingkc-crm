import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
export const dynamic = 'force-dynamic'
export const maxDuration = 45
/** Queue schema is intentionally not invoked until a verified hosting setup enables this route. */
async function run(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({ processed: 0, state: 'disabled_pending_readiness' }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
export async function GET(request: Request) { return run(request) }
export async function POST(request: Request) { return run(request) }
