import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter((file) => /^\d{14}_.*\.sql$/.test(file))
  .sort()

function readMigration(file: string): string {
  return readFileSync(join(migrationsDir, file), 'utf8')
}

function sliceDefinition(suffix: string): string {
  const quote = suffix.match(/\$([A-Za-z0-9_]*)\$/)
  if (!quote) {
    const end = suffix.indexOf(';\n')
    if (end < 0) throw new Error('definition did not end')
    return suffix.slice(0, end + 1)
  }
  const token = quote[0]
  const open = suffix.indexOf(token)
  const close = suffix.indexOf(token, open + token.length)
  if (close < 0) throw new Error(`unclosed ${token}`)
  return suffix.slice(0, close + token.length + 1)
}

function latestDefinition(marker: string): { file: string; sql: string } {
  let found: { file: string; sql: string } | null = null
  for (const file of files) {
    const text = readMigration(file)
    const start = text.lastIndexOf(marker)
    if (start >= 0) found = { file, sql: sliceDefinition(text.slice(start)) }
  }
  if (!found) throw new Error(`missing ${marker}`)
  return found
}

const ALLOWED_COUNTIES = ['jackson', 'clay', 'platte', 'wyandotte', 'johnson']
const UNRESOLVED_SLUGS = ['unknown', 'unresolved']

function slug(value: string | null): string | null {
  if (value == null) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

/** Mirrors the county branch in source_list_phone_block_reasons_v1. */
function countyBlock(county: string | null, situs: string | null): 'out_of_service_area' | 'county_unresolved' | null {
  const slugs = [slug(county), slug(situs)].filter((value): value is string => value !== null)
  const outside = slugs.some((value) => !UNRESOLVED_SLUGS.includes(value) && !ALLOWED_COUNTIES.includes(value))
  const allowed = slugs.some((value) => ALLOWED_COUNTIES.includes(value))
  if (!outside && allowed) return null
  return outside ? 'out_of_service_area' : 'county_unresolved'
}

describe('dialer export gates survive the line-check migration', () => {
  const reasons = latestDefinition('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reasons_v1')
  const review = latestDefinition('CREATE OR REPLACE VIEW public.source_list_dialer_phone_review')
  const exportView = latestDefinition('CREATE OR REPLACE VIEW public.source_list_dialer_export')
  const batch = latestDefinition('CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1')
  const taxAllowed = latestDefinition('CREATE OR REPLACE FUNCTION public.tax_status_export_allowed_v1')
  const lineCheck = readMigration('20261205170000_phone_line_check_review.sql')

  it('keeps Cass out_of_service_area and a null county county_unresolved', () => {
    expect(reasons.file).toBe('20261205150000_dialer_export_speed_f1_stamp.sql')
    expect(reasons.sql).toContain(
      "normalized.slug NOT IN ('unknown', 'unresolved', 'jackson', 'clay', 'platte', 'wyandotte', 'johnson')",
    )
    expect(reasons.sql).toContain("normalized.slug IN ('jackson', 'clay', 'platte', 'wyandotte', 'johnson')")
    expect(reasons.sql).toContain("THEN 'out_of_service_area'")
    expect(reasons.sql).toContain("ELSE 'county_unresolved'")
    expect(countyBlock('Cass', 'Cass')).toBe('out_of_service_area')
    expect(countyBlock('Bates', null)).toBe('out_of_service_area')
    expect(countyBlock(null, null)).toBe('county_unresolved')
    expect(countyBlock('   ', '')).toBe('county_unresolved')
    expect(countyBlock('unknown', 'unknown')).toBe('county_unresolved')
    expect(countyBlock('Unresolved', null)).toBe('county_unresolved')
    expect(countyBlock('Jackson', 'Jackson')).toBeNull()
    expect(review.file).toBe('20261205170000_phone_line_check_review.sql')
    expect(review.sql).toContain('ARRAY(SELECT ordered.county FROM ordered ORDER BY ordered.ordinal)')
    expect(review.sql).toContain('ARRAY(SELECT ordered.situs_county FROM ordered ORDER BY ordered.ordinal)')
    const kept = review.sql.indexOf('WHEN reasons.block_reason IS NOT NULL THEN reasons.block_reason')
    const line = review.sql.indexOf('phone_line_export_block_reason_v1(ordered.phone_value)')
    expect(kept).toBeGreaterThan(0)
    expect(line).toBeGreaterThan(kept)
    expect(lineCheck).not.toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reasons_v1')
  })

  it('does not export a tax-delinquent row with no recent status check', () => {
    expect(exportView.file).toBe('20261205150000_dialer_export_speed_f1_stamp.sql')
    expect(exportView.sql).toContain("list_type IS DISTINCT FROM 'tax_delinquent'")
    expect(exportView.sql).toContain('public.tax_status_export_allowed_v1(parcel_id, county, prospect_id)')
    expect(batch.sql).toContain("export_row.list_type IS DISTINCT FROM 'tax_delinquent' OR public.tax_status_export_allowed_v1")
    expect(batch.sql).toContain('SET jit = off')
    expect(taxAllowed.sql).toContain("check_row.result = 'delinquent'")
    expect(taxAllowed.sql).toContain("interval '7 days'")
    expect(exportView.sql).toMatch(/WHERE block_reason IS NULL\s+AND \(\s*list_type IS DISTINCT FROM 'tax_delinquent'\s+OR public\.tax_status_export_allowed_v1\(parcel_id, county, prospect_id\)\s*\)/)
    expect(lineCheck).not.toContain('CREATE OR REPLACE VIEW public.source_list_dialer_export')
    expect(lineCheck).not.toContain('CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1')
  })

  it('does not bring back the stale #814 migration copies', () => {
    expect(files.filter((file) => file.startsWith('20261202140000_') || file.startsWith('20261202150000_'))).toEqual([])
  })
})
