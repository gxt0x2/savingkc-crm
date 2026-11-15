import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261204120000_tax_status_verification.sql'),
  'utf8',
)

describe('tax status verification migration', () => {
  it('logs the live check on the property and blocks tax export without a fresh delinquent balance', () => {
    expect(migration).toContain('tax_check_at')
    expect(migration).toContain('tax_check_source')
    expect(migration).toContain('tax_check_balance')
    expect(migration).toContain('tax_check_years_owed')
    expect(migration).toContain('tax_check_result')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.tax_status_checks')
    expect(migration).toContain("'jackson_tax_portal'")
    expect(migration).toContain("'johnson_taxbill'")
    expect(migration).toContain("'clay_collector'")
    expect(migration).toContain("'platte_collector'")
    expect(migration).toContain("'wyandotte_tax'")
    expect(migration).not.toContain('cass')
    expect(migration).toContain("interval '7 days'")
    expect(migration).toContain('tax_status_export_allowed_v1')
    expect(migration).toContain("list_type IS DISTINCT FROM 'tax_delinquent'")
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.tax_status_checks')
  })

  it('queues a Mojo removal worklist and does not grant a Mojo write or touch compliance tables', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.tax_status_mojo_removals')
    expect(migration).toContain("'pending_browser'")
    expect(migration).toContain("'confirmed'")
    expect(migration).toContain('contact_name')
    expect(migration).toContain('mojo_list_name')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).not.toMatch(/mojo_call_queue/)
    expect(migration).not.toMatch(/CRON_SECRET/)
    expect(migration).not.toMatch(/sms_opt_outs/)
  })
})
