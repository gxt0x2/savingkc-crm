// POST /api/sms/bulk — bulk SMS is disabled. Outreach is voice only.
// GET /api/sms/bulk?perHour=&perDay= — returns the current account-wide send
// budget so the Text modal can show remaining headroom. It does not send.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import {
  clampPerHour,
  clampPerDay,
  centralDayStartISO,
  nextCentralMidnightISO,
  type SmsBudget,
} from '@/lib/sms-rate-limit'
import { resolveSmsCaps } from '@/lib/twilio-a2p'

export const maxDuration = 60

/** Count successful outbound sends since an ISO instant (account-wide). */
async function countSmsSince(iso: string): Promise<number> {
  const { count, error } = await supabase
    .from('sms_delivery_log')
    .select('id', { count: 'exact', head: true })
    .eq('success', true)
    .gte('created_at', iso)
  if (error) throw error
  return count || 0
}

/**
 * Current send budget for a given pace. Counts real sends in the trailing 60
 * minutes and since midnight CT. FAILS OPEN (full budget) on a counting error
 * so a DB hiccup never blocks legitimate texts — the cap is a guardrail, not a
 * kill switch.
 */
async function computeBudget(perHourReq?: unknown, perDayReq?: unknown): Promise<SmsBudget> {
  // Hard ceiling = our real A2P carrier tier (read live from Twilio, cached),
  // falling back to the conservative static cap if detection is unavailable.
  const caps = await resolveSmsCaps()
  const perHour = clampPerHour(perHourReq, caps.perHour)
  const perDay = clampPerDay(perDayReq, caps.perDay)
  const now = Date.now()
  const hourStartISO = new Date(now - 60 * 60 * 1000).toISOString()
  const dayStartISO = centralDayStartISO(new Date(now))
  let usedHour = 0
  let usedDay = 0
  let hourResetsAt: string | null = null
  try {
    ;[usedHour, usedDay] = await Promise.all([countSmsSince(hourStartISO), countSmsSince(dayStartISO)])
    if (usedHour >= perHour) {
      // The hourly budget frees as the oldest in-window send ages past 60 min.
      const { data } = await supabase
        .from('sms_delivery_log')
        .select('created_at')
        .eq('success', true)
        .gte('created_at', hourStartISO)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (data?.created_at) {
        hourResetsAt = new Date(new Date(data.created_at).getTime() + 60 * 60 * 1000).toISOString()
      }
    }
  } catch (err) {
    console.error('[BULK-SMS] budget count failed — failing open:', err)
    usedHour = 0
    usedDay = 0
    hourResetsAt = null
  }
  const remainingHour = Math.max(0, perHour - usedHour)
  const remainingDay = Math.max(0, perDay - usedDay)
  return {
    perHour,
    perDay,
    hardPerHour: caps.perHour,
    hardPerDay: caps.perDay,
    usedHour,
    usedDay,
    remainingHour,
    remainingDay,
    allowedNow: Math.min(remainingHour, remainingDay),
    hourResetsAt,
    dayResetsAt: nextCentralMidnightISO(new Date(now)),
    tier: caps.tier,
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const budget = await computeBudget(searchParams.get('perHour'), searchParams.get('perDay'))
  return NextResponse.json({ ok: true, budget })
}

export async function POST() {
  console.error('[BULK-SMS] refused bulk SMS send: not a human-initiated 1:1 send (sms.conversation.1to1.v1)')
  return NextResponse.json({
    ok: false,
    error: 'Bulk SMS is disabled. Only a human-initiated 1:1 send is allowed.',
  }, { status: 403 })
}
