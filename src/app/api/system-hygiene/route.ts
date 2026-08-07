import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { getSystemHygieneSnapshot } from '@/lib/system-hygiene/snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  return NextResponse.json(await getSystemHygieneSnapshot(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
