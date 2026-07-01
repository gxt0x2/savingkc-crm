import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scSendSms } from '@/lib/smartercontact/messaging'
import { resetDailyCountersIfNeeded } from '@/lib/smartercontact/numbers'
import type { ScCampaign } from '@/lib/smartercontact/types'

/**
 * GET|POST /api/cron/sc-campaign-sender
 *
 * The Standard-campaign send worker. Runs on a schedule (e.g. every minute).
 * For each active standard campaign it:
 *   - respects an optional daily send window (in the campaign timezone),
 *   - throttles to a per-run batch derived from throttle_per_hour,
 *   - sends each pending recipient through the number pool via scSendSms,
 *   - records per-recipient outcome + rolls campaign counters,
 *   - completes the campaign when no pending recipients remain.
 *
 * Protected by CRON_SECRET: `Authorization: Bearer <secret>` or `?secret=`.
 */

// Hard per-run cap so a single invocation can't monopolize the pool.
const BATCH_CAP = 100

/**
 * Whether "now" falls inside a campaign's daily send window, evaluated in the
 * campaign's timezone. Windows may wrap past midnight (start > end).
 * Returns true when no window is configured.
 */
function withinSendWindow(campaign: ScCampaign): boolean {
  if (!campaign.send_window_start || !campaign.send_window_end) return true

  // Current wall-clock minutes-of-day in the campaign timezone.
  let hh = 0
  let mm = 0
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: campaign.timezone || 'America/Chicago',
    }).formatToParts(new Date())
    hh = Number(parts.find((p) => p.type === 'hour')?.value || '0')
    mm = Number(parts.find((p) => p.type === 'minute')?.value || '0')
  } catch {
    // Unknown timezone → don't gate sending.
    return true
  }
  const nowMin = (hh % 24) * 60 + mm

  const toMin = (t: string): number => {
    const [h, m] = t.split(':')
    return (Number(h) || 0) * 60 + (Number(m) || 0)
  }
  const startMin = toMin(campaign.send_window_start)
  const endMin = toMin(campaign.send_window_end)

  if (startMin <= endMin) {
    // Same-day window, e.g. 09:00–20:00.
    return nowMin >= startMin && nowMin < endMin
  }
  // Overnight window, e.g. 20:00–06:00.
  return nowMin >= startMin || nowMin < endMin
}

async function run(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    const querySecret = new URL(req.url).searchParams.get('secret')
    if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = supabaseAdmin()
  await resetDailyCountersIfNeeded()

  const { data: campaigns, error } = await db
    .from('sc_campaigns')
    .select('*')
    .eq('type', 'standard')
    .eq('status', 'active')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const summary = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    campaigns: [] as Array<{
      id: string
      name: string
      sent: number
      failed: number
      skipped: number
      remaining: number
      status: string
      note?: string
    }>,
  }

  for (const c of (campaigns || []) as ScCampaign[]) {
    summary.processed += 1

    // Gate by send window (if configured).
    if (!withinSendWindow(c)) {
      summary.campaigns.push({
        id: c.id,
        name: c.name,
        sent: 0,
        failed: 0,
        skipped: 0,
        remaining: 0,
        status: c.status,
        note: 'outside_send_window',
      })
      continue
    }

    // Throttle: throttle_per_hour spread over ~60 one-minute runs, capped.
    // e.g. 500/hr → ~9 per run; clamp to [1, BATCH_CAP].
    const perRun = Math.max(
      1,
      Math.min(Math.ceil((c.throttle_per_hour || 0) / 60), BATCH_CAP),
    )

    const { data: pending } = await db
      .from('sc_campaign_recipients')
      .select('id, contact_id, phone, rendered_body')
      .eq('campaign_id', c.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(perRun)

    // No pending left → complete the campaign.
    if (!pending || pending.length === 0) {
      await db
        .from('sc_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', c.id)
      summary.campaigns.push({
        id: c.id,
        name: c.name,
        sent: 0,
        failed: 0,
        skipped: 0,
        remaining: 0,
        status: 'completed',
      })
      continue
    }

    const poolIds =
      c.from_strategy === 'pool' && c.sending_number_ids?.length
        ? c.sending_number_ids
        : undefined

    let sent = 0
    let failed = 0
    let skipped = 0

    for (const r of pending) {
      const res = await scSendSms({
        toPhone: r.phone,
        body: r.rendered_body || c.message_body || '',
        poolIds,
        contactId: r.contact_id,
        campaignId: c.id,
        sticky: false,
      })

      if (res.success) {
        await db
          .from('sc_campaign_recipients')
          .update({
            status: 'sent',
            twilio_sid: res.sid ?? null,
            sending_number: res.from ?? null,
            error: null,
            sent_at: new Date().toISOString(),
          })
          .eq('id', r.id)
        sent += 1
      } else if (res.skipped === 'opted_out') {
        await db
          .from('sc_campaign_recipients')
          .update({ status: 'skipped', error: 'opted_out' })
          .eq('id', r.id)
        skipped += 1
      } else {
        await db
          .from('sc_campaign_recipients')
          .update({
            status: 'failed',
            error: res.error || res.skipped || 'send_failed',
            sending_number: res.from ?? null,
          })
          .eq('id', r.id)
        failed += 1
      }
    }

    // Roll campaign counters (single-writer cron → read-modify-write is fine).
    const { data: fresh } = await db
      .from('sc_campaigns')
      .select('sent_count, failed_count, optout_count')
      .eq('id', c.id)
      .single()
    await db
      .from('sc_campaigns')
      .update({
        sent_count: (fresh?.sent_count || 0) + sent,
        failed_count: (fresh?.failed_count || 0) + failed,
        optout_count: (fresh?.optout_count || 0) + skipped,
      })
      .eq('id', c.id)

    const { count: remaining } = await db
      .from('sc_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .eq('status', 'pending')

    // If we drained the queue this run, mark it complete.
    if (!remaining || remaining === 0) {
      await db
        .from('sc_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', c.id)
    }

    summary.sent += sent
    summary.failed += failed
    summary.skipped += skipped
    summary.campaigns.push({
      id: c.id,
      name: c.name,
      sent,
      failed,
      skipped,
      remaining: remaining || 0,
      status: !remaining || remaining === 0 ? 'completed' : 'active',
    })
  }

  return NextResponse.json(summary)
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
