import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runGoogleAdsReportingSync } from '@/lib/marketing/google-ads-reporting-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function parseDate(value: string | null): string | undefined {
  return value && DATE_RE.test(value) ? value : undefined
}

function chicagoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function readLookbackDays(value: string | null): number {
  const parsed = Number(value || process.env.GOOGLE_ADS_REPORTING_SYNC_LOOKBACK_DAYS || 7)
  if (!Number.isFinite(parsed) || parsed < 1) return 7
  return Math.min(30, Math.floor(parsed))
}

async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const dryRun = parseBool(url.searchParams.get('dryRun'))
  const today = chicagoDate()
  const lookbackDays = readLookbackDays(url.searchParams.get('lookbackDays'))
  const since = parseDate(url.searchParams.get('since')) || addDays(today, -(lookbackDays - 1))
  const until = parseDate(url.searchParams.get('until')) || today
  const includeSearchTerms = !['0', 'false', 'no'].includes((url.searchParams.get('searchTerms') || '').toLowerCase())

  try {
    const result = await runGoogleAdsReportingSync({
      since,
      until,
      write: !dryRun,
      includeSearchTerms,
    })
    return NextResponse.json({ ...result, lookbackDays })
  } catch (error) {
    console.error('[google-ads-reporting-sync] failed', error)
    return NextResponse.json(
      {
        ok: false,
        dryRun,
        since,
        until,
        lookbackDays,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
