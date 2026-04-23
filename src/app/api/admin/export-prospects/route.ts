import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

// GET /api/admin/export-prospects
//   Defaults pull the "deceased + 2+yr + still behind since 2024" list for
//   Jackson and Johnson counties. All filters are overridable via query string.
//
//   ?counties=jackson,johnson       (default)
//   ?deceased=true                  (default; pass false to drop the filter)
//   ?earliest_year_lte=2024         (default; pass 0 to drop the filter)
//   ?format=csv | json              (default csv; triggers a file download)
//   ?limit=5000                     (default 5000)

const DEFAULT_COUNTIES = ['jackson', 'johnson']
const DEFAULT_EARLIEST_YEAR = 2024
const DEFAULT_LIMIT = 5000

const CSV_COLUMNS: Array<[string, string]> = [
  ['county', 'County'],
  ['parcel_id', 'Parcel ID'],
  ['owner_1', 'Owner'],
  ['owner_1_first', 'Owner First'],
  ['owner_1_last', 'Owner Last'],
  ['situs_address', 'Situs Address'],
  ['situs_street', 'Situs Street'],
  ['situs_city', 'Situs City'],
  ['situs_state', 'Situs State'],
  ['situs_zip', 'Situs Zip'],
  ['mailing_street', 'Mailing Street'],
  ['mailing_city', 'Mailing City'],
  ['mailing_state', 'Mailing State'],
  ['mailing_zip', 'Mailing Zip'],
  ['cumulative_due', 'Cumulative Due'],
  ['earliest_delinquent_year', 'Earliest Delinquent Year'],
  ['delinquent_years_category', 'Delinquent Years Category'],
  ['total_market_value', 'Total Market Value'],
  ['zestimate', 'Zestimate'],
  ['occupancy_status', 'Occupancy Status'],
  ['is_deceased', 'Is Deceased'],
  ['is_skip_traced', 'Is Skip Traced'],
  ['owner_phone_1', 'Owner Phone 1'],
  ['owner_phone_2', 'Owner Phone 2'],
  ['email_1', 'Email 1'],
  ['relative_1_name', 'Relative 1 Name'],
  ['relative_1_phone', 'Relative 1 Phone'],
  ['relative_1_relationship', 'Relative 1 Relationship'],
  ['relative_2_name', 'Relative 2 Name'],
  ['relative_2_phone', 'Relative 2 Phone'],
  ['relative_2_relationship', 'Relative 2 Relationship'],
  ['relative_3_name', 'Relative 3 Name'],
  ['relative_3_phone', 'Relative 3 Phone'],
  ['relative_3_relationship', 'Relative 3 Relationship'],
]

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: Record<string, unknown>[]): string {
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',')
  const body = rows
    .map((row) => CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','))
    .join('\n')
  return `${header}\n${body}\n`
}

export async function GET(req: Request) {
  const url = new URL(req.url)

  const counties = (url.searchParams.get('counties') ?? DEFAULT_COUNTIES.join(','))
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

  const deceasedParam = url.searchParams.get('deceased')
  const deceasedOnly = deceasedParam === null ? true : deceasedParam === 'true'

  const earliestYearLteRaw = url.searchParams.get('earliest_year_lte')
  const earliestYearLte =
    earliestYearLteRaw === null
      ? DEFAULT_EARLIEST_YEAR
      : Number.parseInt(earliestYearLteRaw, 10)

  const limit = Math.min(
    Number.parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    20_000,
  )

  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase()

  let query = supabase
    .from('prospects')
    .select(CSV_COLUMNS.map(([k]) => k).join(','))
    .in('county', counties)
    .order('county', { ascending: true })
    .order('situs_city', { ascending: true })
    .order('owner_1', { ascending: true })
    .limit(limit)

  if (deceasedOnly) query = query.eq('is_deceased', true)
  if (Number.isFinite(earliestYearLte) && earliestYearLte > 0) {
    query = query.lte('earliest_delinquent_year', earliestYearLte)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  if (format === 'json') {
    return NextResponse.json({
      filters: { counties, deceasedOnly, earliestYearLte, limit },
      count: rows.length,
      rows,
    })
  }

  const csv = toCsv(rows)
  const date = new Date().toISOString().slice(0, 10)
  const filename = `deceased-prospects-${counties.join('-')}-${date}.csv`
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
