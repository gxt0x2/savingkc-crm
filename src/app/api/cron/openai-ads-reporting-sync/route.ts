import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { runOpenAIAdsReportingSync } from '@/lib/marketing/openai-ads-reporting-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_LOOKBACK_DAYS = 30

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
  const parsed = Number(value || process.env.OPENAI_ADS_REPORTING_SYNC_LOOKBACK_DAYS || DEFAULT_LOOKBACK_DAYS)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LOOKBACK_DAYS
  return Math.min(30, Math.floor(parsed))
}

async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const dryRun = parseBool(url.searchParams.get('dryRun'))
  const latestReportableDate = chicagoDate()
  const lookbackDays = readLookbackDays(url.searchParams.get('lookbackDays'))
  const requestedUntil = parseDate(url.searchParams.get('until')) || latestReportableDate
  const until = requestedUntil > latestReportableDate ? latestReportableDate : requestedUntil
  const since = parseDate(url.searchParams.get('since')) || addDays(until, -(lookbackDays - 1))

  try {
    const result = await runOpenAIAdsReportingSync({
      since,
      until,
      write: !dryRun,
    })
    return NextResponse.json({ ...result, lookbackDays })
  } catch (error) {
    console.error('[openai-ads-reporting-sync] failed', error)
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
