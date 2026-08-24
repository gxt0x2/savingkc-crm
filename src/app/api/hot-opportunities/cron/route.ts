import { NextResponse } from 'next/server'

export async function GET() {
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
