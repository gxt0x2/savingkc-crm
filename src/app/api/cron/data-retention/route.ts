import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runDataRetention } from '@/lib/system-hygiene/retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request, allowApply: boolean) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const apply = allowApply && url.searchParams.get('mode') === 'apply'
  const result = await runDataRetention({
    apply,
    invokedBy: apply ? 'admin-request' : 'scheduled-monitor',
  })

  const status = result.blocked ? 409 : result.available ? (result.error ? 500 : 200) : 503
  return NextResponse.json(result, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: Request) {
  return handle(request, false)
}

export async function POST(request: Request) {
  return handle(request, true)
}
