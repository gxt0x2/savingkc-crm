import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  return NextResponse.json(
    {
      error: 'Hot-opportunities reranking has been retired',
      code: 'HOT_ENGINE_RETIRED',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

export const dynamic = 'force-dynamic'
