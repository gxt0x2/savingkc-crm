// POST /api/sms/bulk — text many leads at once with one (optionally templated)
// message. Reuses sendLeadSms per recipient so opt-out, 24h de-dupe, smart
// from-number, logging, and pipeline auto-advance behave exactly like a single
// send. Each send lands in the lead's Communication Hub.
//
// Body: { leadIds: string[], templateName?: string, body?: string,
//         fromPhone?: string, agent?: string, force?: boolean,
//         perHour?: number, perDay?: number }
//
// GET /api/sms/bulk?perHour=&perDay= — returns the current account-wide send
// budget so the Text modal can show remaining headroom before sending.
//
// RATE GUARDRAIL: outbound SMS volume is capped account-wide (across every
// number and agent) to protect carrier/A2P reputation. A firm HARD cap lives in
// code; operators can pace below it via perHour/perDay. Usage is counted from
// sms_delivery_log (written by safeSendSMS on every send). See lib/sms-rate-limit.
//
// NOTE (compliance): texting hours are enforced as Mon–Sat 9am–7pm Central to
// match the automated worker. Heirs span timezones, so for strict TCPA quiet
// hours we'd need per-lead timezone — see roadmap. `force` (admin) bypasses.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { getTemplate, resolveTemplate, incrementUsage } from '@/lib/sms-templates'
import { BULK_SMS_MAX, isWithinTextingHours, summarizeBulkSms, describeBulkResult, type BulkSmsItem, type BulkSmsSummary } from '@/lib/bulk-sms'
import {
  SMS_HARD_PER_HOUR,
  SMS_HARD_PER_DAY,
  clampPerHour,
  clampPerDay,
  centralDayStartISO,
  nextCentralMidnightISO,
  type SmsBudget,
} from '@/lib/sms-rate-limit'

export const maxDuration = 60

const CONCURRENCY = 8

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
}

const EMPTY_SUMMARY: BulkSmsSummary = {
  total: 0, sent: 0, skipped: 0, failed: 0,
  breakdown: { opted_out: 0, duplicate: 0, no_phone: 0, not_found: 0 },
}

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
  const perHour = clampPerHour(perHourReq)
  const perDay = clampPerDay(perDayReq)
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
    hardPerHour: SMS_HARD_PER_HOUR,
    hardPerDay: SMS_HARD_PER_DAY,
    usedHour,
    usedDay,
    remainingHour,
    remainingDay,
    allowedNow: Math.min(remainingHour, remainingDay),
    hourResetsAt,
    dayResetsAt: nextCentralMidnightISO(new Date(now)),
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const budget = await computeBudget(searchParams.get('perHour'), searchParams.get('perDay'))
  return NextResponse.json({ ok: true, budget })
}

export async function POST(req: Request) {
  try {
    const { leadIds, templateName, body, fromPhone, agent, force, perHour, perDay } = await req.json()

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds (non-empty array) is required' }, { status: 400 })
    }
    const ids: string[] = [...new Set(leadIds.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid lead IDs' }, { status: 400 })
    }
    if (ids.length > BULK_SMS_MAX) {
      return NextResponse.json({ error: `Too many recipients (${ids.length}). Max ${BULK_SMS_MAX} per send.` }, { status: 400 })
    }
    if (!templateName && !body?.trim()) {
      return NextResponse.json({ error: 'Provide a templateName or a message body' }, { status: 400 })
    }
    if (!force && !isWithinTextingHours()) {
      return NextResponse.json({ error: 'Outside texting hours (Mon–Sat 9am–7pm CT)' }, { status: 422 })
    }

    // Account-wide rate guardrail: only send up to the remaining budget; the
    // caller batches, so each request is re-checked against live usage.
    const budget = await computeBudget(perHour, perDay)
    const sendIds = ids.slice(0, Math.max(0, budget.allowedNow))
    const deferred = ids.length - sendIds.length
    if (sendIds.length === 0) {
      return NextResponse.json({
        ok: true,
        rateLimited: true,
        deferred,
        budget,
        summary: EMPTY_SUMMARY,
        message: `Sending cap reached — ${budget.usedHour}/${budget.perHour} this hour, ${budget.usedDay}/${budget.perDay} today.`,
      })
    }

    // Resolve the message template (falls back to the raw body).
    let baseBody = body?.trim() || ''
    if (templateName) {
      const tpl = await getTemplate(templateName)
      if (!tpl) return NextResponse.json({ error: `Template "${templateName}" not found` }, { status: 404 })
      baseBody = tpl.body
    }

    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, property_address')
      .in('id', sendIds)
    const byId = new Map<string, LeadRow>((leads as LeadRow[] | null ?? []).map((l) => [l.id, l]))

    // Send with bounded concurrency so a large batch doesn't serialize into a
    // timeout or hammer Twilio all at once.
    const items: BulkSmsItem[] = []
    for (let i = 0; i < sendIds.length; i += CONCURRENCY) {
      const chunk = sendIds.slice(i, i + CONCURRENCY)
      const settled = await Promise.all(chunk.map(async (leadId): Promise<BulkSmsItem> => {
        const lead = byId.get(leadId)
        if (!lead) return { leadId, status: 'skipped', reason: 'not_found' }
        if (!lead.phone) return { leadId, status: 'skipped', reason: 'no_phone' }

        const text = resolveTemplate(baseBody, { full_name: lead.full_name, property_address: lead.property_address })
        const r = await sendLeadSms({ leadId, phone: lead.phone, body: text, fromPhone, agent })
        if (r.status === 'sent') return { leadId, status: 'sent' }
        if (r.status === 'failed') return { leadId, status: 'failed', error: r.error }
        return { leadId, status: 'skipped', reason: r.reason }
      }))
      items.push(...settled)
    }

    const summary = summarizeBulkSms(items)
    if (templateName && summary.sent > 0) {
      incrementUsage(templateName).catch((err) => console.error('[BULK-SMS] usage increment failed:', err))
    }

    const budgetAfter = await computeBudget(perHour, perDay)
    return NextResponse.json({
      ok: true,
      summary,
      message: describeBulkResult(summary),
      results: items,
      budget: budgetAfter,
      rateLimited: deferred > 0,
      deferred,
    })
  } catch (err) {
    console.error('[BULK-SMS] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
