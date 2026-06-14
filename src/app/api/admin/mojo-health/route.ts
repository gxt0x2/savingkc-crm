import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { getMojoHealth, persistMojoHealth } from '@/lib/marketing/mojo-health'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
      || req.nextUrl.searchParams.get('dryRun') === 'true'

    const supabase = supabaseAdmin()
    const health = await getMojoHealth(supabase)
    if (!dryRun) {
      await persistMojoHealth(supabase, health)
    }

    return NextResponse.json(
      {
        ok: health.status !== 'attention',
        dryRun,
        health,
      },
      {
        status: health.status === 'attention' ? 503 : 200,
        headers: NO_STORE_HEADERS,
      },
    )
  } catch (error) {
    console.error('[mojo-health] failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Mojo health monitor failed',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
