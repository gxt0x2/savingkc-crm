export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { fetchA2pDiagnostic } from '@/lib/twilio-a2p'
import { hourlyCapForDaily } from '@/lib/a2p-tier'

/**
 * GET /api/admin/dialer-health
 *
 * One-stop diagnostic for "why is the dialer broken right now?". Returns:
 *   - Twilio account status + balance
 *   - All verified outgoing caller IDs (so we can spot a de-listed Casey/Ernest number)
 *   - Last 10 browser-initiated outbound calls with their final Status + ErrorCode
 *
 * The "silence then drop tone" Casey hits is almost always a carrier rejection
 * that surfaces as ErrorCode on the Call resource. Without status callbacks
 * wired up we never see it; this endpoint pulls it from Twilio on demand.
 *
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET (or signed-in admin).
 */
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  if (!accountSid || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID / TWILIO_API_KEY / TWILIO_API_SECRET not configured' },
      { status: 500 },
    )
  }

  const creds = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  const auth = { Authorization: `Basic ${creds}` }

  const fetchJson = async (path: string) => {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${path}`, {
      headers: auth,
      cache: 'no-store',
    })
    if (!res.ok) {
      return { error: `${res.status} ${res.statusText}`, body: await res.text().catch(() => '') }
    }
    return res.json()
  }

  const [account, balance, callerIds, calls, a2p] = await Promise.all([
    fetchJson('.json'),
    fetchJson('Balance.json'),
    fetchJson('OutgoingCallerIds.json?PageSize=50'),
    fetchJson('Calls.json?PageSize=20'),
    fetchA2pDiagnostic(),
  ])

  type TwilioCall = {
    sid: string
    from: string
    to: string
    status: string
    direction: string
    duration: string | null
    price: string | null
    start_time: string | null
    end_time: string | null
  } & Record<string, unknown>

  const browserCalls: TwilioCall[] = Array.isArray((calls as { calls?: TwilioCall[] })?.calls)
    ? (calls as { calls: TwilioCall[] }).calls
        .filter((c) => typeof c.from === 'string' && c.from.startsWith('client:'))
        .slice(0, 10)
    : []

  const summary = {
    account: {
      status: (account as { status?: string })?.status ?? 'unknown',
      type: (account as { type?: string })?.type ?? 'unknown',
      friendlyName: (account as { friendly_name?: string })?.friendly_name ?? null,
    },
    balance: {
      balance: (balance as { balance?: string })?.balance ?? null,
      currency: (balance as { currency?: string })?.currency ?? 'USD',
    },
    verifiedCallerIds: Array.isArray((callerIds as { outgoing_caller_ids?: unknown[] })?.outgoing_caller_ids)
      ? (callerIds as { outgoing_caller_ids: Array<{ phone_number: string; friendly_name: string }> })
          .outgoing_caller_ids.map((c) => ({
            phone: c.phone_number,
            label: c.friendly_name,
          }))
      : [],
    recentBrowserCalls: browserCalls.map((c) => {
      const errorCode = (c as { 'api_error_code'?: number; error_code?: number }).error_code
        ?? (c as { 'api_error_code'?: number }).api_error_code
        ?? null
      return {
        sid: c.sid,
        from: c.from,
        to: c.to,
        status: c.status,
        direction: c.direction,
        durationSec: c.duration ? Number(c.duration) : null,
        price: c.price,
        errorCode,
        errorMessage: (c as { error_message?: string }).error_message ?? null,
        startTime: c.start_time,
        endTime: c.end_time,
      }
    }),
    // A2P 10DLC brand tier — drives the account-wide SMS sending cap.
    a2p: {
      brandType: a2p.tier.brandType,
      trustScore: a2p.tier.trustScore,
      vetted: a2p.tier.vetted,
      label: a2p.tier.label,
      carrierDailyCap: a2p.tier.carrierDailyCap,
      recommendedPerHour: hourlyCapForDaily(a2p.tier.carrierDailyCap),
      source: a2p.tier.source,
      detail: a2p.detail,
    },
    issues: [] as string[],
  }

  // Surface common failure patterns inline so a quick read of the JSON tells
  // the story without forcing the operator to hand-decode error codes.
  const expectedCallerIds = ['+18166088588', '+18167277667', '+18163077835']
  const verifiedSet = new Set(summary.verifiedCallerIds.map((c) => c.phone))
  for (const expected of expectedCallerIds) {
    if (!verifiedSet.has(expected)) {
      summary.issues.push(`Caller ID ${expected} is NOT in the verified list — Twilio will reject outbound calls using it.`)
    }
  }
  const bal = Number(summary.balance.balance)
  if (Number.isFinite(bal) && bal < 5) {
    summary.issues.push(`Twilio balance is $${bal.toFixed(2)} — top up the account.`)
  }
  if (summary.account.status && summary.account.status !== 'active') {
    summary.issues.push(`Twilio account status is "${summary.account.status}".`)
  }
  const failedRecent = summary.recentBrowserCalls.filter((c) =>
    c.status === 'failed' || c.status === 'canceled' || (typeof c.errorCode === 'number' && c.errorCode > 0),
  )
  if (failedRecent.length >= 3) {
    summary.issues.push(`${failedRecent.length} of the last ${summary.recentBrowserCalls.length} browser calls failed — check ErrorCode in recentBrowserCalls.`)
  }
  if (summary.a2p.source === 'fallback') {
    summary.issues.push(`A2P brand tier could not be read from Twilio — SMS cap is using the conservative ${summary.a2p.carrierDailyCap.toLocaleString()}/day fallback. Verify the brand registration and TWILIO_API_KEY/SECRET.`)
  }

  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
