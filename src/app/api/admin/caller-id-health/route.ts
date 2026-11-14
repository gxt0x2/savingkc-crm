import { NextRequest, NextResponse } from 'next/server'

import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { CallerIdUpsertError, parseCallerIdActiveTarget, parseCallerIdUpsert } from '@/lib/telephony/caller-id-health'
import { callerIdHealthStore, saveCallerId, saveCallerIdActiveTarget } from '@/lib/telephony/caller-id-health-db'
import { CallerIdHealthError, summarizeCallerIdHealth } from '@/lib/telephony/caller-id-health-run'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
}

/**
 * POST loads one number after the owner attests Mojo caller-ID verification,
 * or sets caller_id_active_target (1–10, default 3). It does not call Mojo
 * or Twilio, and it does not release or delete a number.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Caller ID load needs JSON.' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  const hasPhone = typeof record?.phone === 'string'
  const hasTarget = record != null && 'activeTarget' in record
  if (!record || hasPhone === hasTarget) {
    return NextResponse.json({ ok: false, error: 'Send a verified phone or an activeTarget, not both.' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const db = supabaseAdmin()
    if (hasTarget) {
      const activeTarget = parseCallerIdActiveTarget(record.activeTarget)
      await saveCallerIdActiveTarget(db, activeTarget)
      return NextResponse.json({ ok: true, activeTarget }, { headers: NO_STORE_HEADERS })
    }
    const callerId = parseCallerIdUpsert(record)
    const saved = await saveCallerId(db, callerId)
    return NextResponse.json({ ok: true, callerId: saved }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof CallerIdUpsertError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400, headers: NO_STORE_HEADERS })
    }
    const message = error instanceof Error ? error.message : 'Caller ID load failed'
    return NextResponse.json({ ok: false, error: message }, { status: 503, headers: NO_STORE_HEADERS })
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const summary = await summarizeCallerIdHealth(callerIdHealthStore(supabaseAdmin()), new Date())
    return NextResponse.json(summary, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const code = error instanceof CallerIdHealthError ? error.code : 'health_unavailable'
    const message = error instanceof Error ? error.message : 'Caller ID health summary failed'
    return NextResponse.json({ ok: false, readOnly: true, code, error: message }, { status: 503, headers: NO_STORE_HEADERS })
  }
}
