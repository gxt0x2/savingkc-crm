import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runPhoneLineChecks } from '@/lib/server/phone-line-check'
import { phoneLineCheckStore } from '@/lib/server/phone-line-check-store'
import { createTwilioLookupClient, lookupPhoneLine } from '@/lib/server/phone-line-lookup'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store' }

// The day's calling list locks at 4:00am America/Chicago. vercel.json is UTC,
// so the schedule is '0 8 * * *' (08:00 UTC). That is 2:00am CST (UTC-6) and
// 3:00am CDT (UTC-5). 09:00 UTC would land on the 4:00am lock during daylight
// time, so this stays an hour earlier all year. The run is bounded to a few
// minutes and finishes before the lock.

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not configured')) {
    return NextResponse.json({ ok: false, error: 'Twilio Lookup is not configured' }, { status: 503, headers: HEADERS })
  }
  console.error('[line-check] cron failed', message.slice(0, 180))
  return NextResponse.json({ ok: false, error: 'Line check is unavailable' }, { status: 503, headers: HEADERS })
}

export async function GET(request: Request) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const client = createTwilioLookupClient()
    const summary = await runPhoneLineChecks({
      store: phoneLineCheckStore(supabaseAdmin()),
      lookup: (phone) => lookupPhoneLine(client, phone),
      source: 'cron',
      actor: 'line-check-cron',
      batchSize: 40,
      deadlineMs: Date.now() + 240_000,
    })
    return NextResponse.json(summary, { headers: HEADERS })
  } catch (error) {
    return failure(error)
  }
}
