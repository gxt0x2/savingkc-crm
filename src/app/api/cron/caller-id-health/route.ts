import { NextRequest, NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { callerIdHealthStore } from '@/lib/telephony/caller-id-health-db'
import { CallerIdHealthError, runCallerIdHealth } from '@/lib/telephony/caller-id-health-run'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
}

async function handle(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await runCallerIdHealth(callerIdHealthStore(supabaseAdmin()), new Date())
    return NextResponse.json(result, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const code = error instanceof CallerIdHealthError ? error.code : 'health_unavailable'
    const message = error instanceof Error ? error.message : 'Caller ID health failed'
    return NextResponse.json({ ok: false, code, error: message }, { status: 503, headers: NO_STORE_HEADERS })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
