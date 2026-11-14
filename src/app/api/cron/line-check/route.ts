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

// 7:30am America/Chicago. vercel.json stores cron schedules in UTC, so the
// schedule is '30 13 * * *' while Chicago is on standard time (UTC-6).
// Daylight time (second Sunday in March through the first Sunday in November)
// is UTC-5, and 13:30 UTC becomes 8:30am Chicago until the schedule moves to
// '30 12 * * *'.

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
