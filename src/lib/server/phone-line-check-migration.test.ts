import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261205160000_phone_line_checks.sql', 'utf8')
const applyStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.apply_phone_line_checks_v1')
const applySql = migration.slice(applyStart, migration.indexOf('REVOKE ALL ON FUNCTION public.phone_line_rnd_clear_v1'))
const updateStart = applySql.indexOf('UPDATE public.prospect_phones AS phone')
const updateSql = applySql.slice(updateStart, applySql.indexOf('v_accepted := v_accepted + 1'))

describe('phone line check migration', () => {
  it('adds the phone columns, the append-only ledger, and the hard caps', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS line_type text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS line_status text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS line_checked_at timestamptz')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS line_check_raw jsonb')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS line_recheck_count integer NOT NULL DEFAULT 0')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS line_suppressed_at timestamptz')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.phone_line_checks')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.phone_line_check_cap_log')
    expect(migration).toContain('Retain for 5 years')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.phone_line_checks')
    expect(migration).toContain('phone_line_checks_append_only')
    expect(migration).toContain('1500 - v_phones')
    expect(migration).toContain('15 - v_cost_today')
    expect(migration).toContain('60 - v_cost_month')
    expect(migration).toContain('0.015')
    expect(migration).toContain("America/Chicago")
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.phone_line_checks, public.phone_line_check_cap_log')
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
  })

  it('writes through the security definer function and never touches last_disposition', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(updateSql).toContain('line_status = v_status')
    expect(updateSql).toContain("THEN 'connected'")
    expect(updateSql).toContain("IS DISTINCT FROM 'mojo'")
    expect(updateSql).toContain("position('casey'")
    expect(updateSql).not.toMatch(/last_disposition\s*=/)
    expect(updateSql).not.toMatch(/voice_hold\s*=/)
    expect(applySql).not.toMatch(/\bUPDATE\s+public\.phone_line_checks\b/)
    expect(applySql).not.toMatch(/\bDELETE\s+FROM\b/)
  })

  it('encodes the counsel outcomes and the RND hook', () => {
    expect(migration).toContain('RND HOOK')
    expect(migration).toContain("RETURN 'unavailable'")
    expect(migration).toContain("'suppressed_lookup_inactive'")
    expect(migration).toContain("'lookup_inactive'")
    expect(migration).toContain("'recheck_still_inactive'")
    expect(migration).toContain("'recheck_active_rnd_unavailable'")
    expect(migration).toContain("'recheck_active_rnd_clear'")
    expect(migration).toContain("'dial_disconnect'")
    expect(migration).toContain("'unreachable_hold'")
    expect(migration).toContain("'check_failed_stale_active'")
    expect(migration).toContain("interval '7 days'")
    expect(migration).toContain("interval '30 days'")
    expect(migration).toContain("interval '90 days'")
    expect(migration).toContain("WHEN 'reachable' THEN 'active'")
    expect(migration).toContain("WHEN 'inactive' THEN 'inactive'")
    expect(migration).toContain("WHEN 'nonfixedvoip' THEN 'nonFixedVoip'")
  })

  it('does not replace the #814 scrub or its classifier', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.dialer_suppression_class_v1')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.apply_mojo_dial_phone_stamp_v1')
    expect(migration).not.toContain('CREATE OR REPLACE VIEW public.source_list_dialer_phone_review')
  })
})

const review = readFileSync('supabase/migrations/20261205170000_phone_line_check_review.sql', 'utf8')

describe('line check review migration on the #814 scrub', () => {
  it('appends a line-check reason only when the #814 scrub returns null', () => {
    const viewStart = review.indexOf('CREATE OR REPLACE VIEW public.source_list_dialer_phone_review')
    const view = review.slice(viewStart, review.indexOf('COMMENT ON VIEW public.source_list_dialer_phone_review'))
    const kept = view.indexOf('WHEN reasons.block_reason IS NOT NULL THEN reasons.block_reason')
    const line = view.indexOf('phone_line_export_block_reason_v1(ordered.phone_value)')
    expect(kept).toBeGreaterThan(0)
    expect(line).toBeGreaterThan(kept)
    expect(view).toContain('source_list_phone_block_reasons_v1')
    expect(view).toContain('ARRAY(SELECT ordered.county FROM ordered ORDER BY ordered.ordinal)')
    expect(view).toContain('ARRAY(SELECT ordered.situs_county FROM ordered ORDER BY ordered.ordinal)')
    expect(view).toContain('phone_line_check_block_enabled_v1')
    expect(review).toContain('public.source_list_phone_block_reason_v1(p_phone, NULL::uuid)')
    expect(review).toContain("THEN 'line_check_unknown'")
    expect(review).toContain("THEN 'line_check_stale'")
    expect(review).toContain("ELSE 'sms_requires_mobile'")
    expect(review).not.toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(review).not.toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reasons_v1')
    expect(review).not.toContain('CREATE OR REPLACE FUNCTION public.dialer_suppression_class_v1')
    expect(review).not.toContain('CREATE OR REPLACE FUNCTION public.apply_mojo_dial_phone_stamp_v1')
    expect(review).not.toContain('CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1')
    expect(review).not.toContain('CREATE OR REPLACE VIEW public.source_list_dialer_export')
    expect(review).not.toMatch(/LIKE\s+'%dnc%'/i)
    expect(review).toContain('line_last_active_at')
    expect(review).toContain('FOR UPDATE')
    expect(review).toContain("status IN ('ready', 'loaded_to_dialer')")
    expect(review).toContain("'fresh_intake'")
    expect(review).toContain("'calling_window_lock'")
    expect(review).toContain('Counsel ruling §4a, 2026-11-14 (Lookup inactive)')
  })

  it('floors every configured price at $0.015 so a day never grants more than 1,000 lookups', () => {
    const unitCost = review.slice(
      review.indexOf('CREATE OR REPLACE FUNCTION public.phone_line_check_unit_cost_v1'),
      review.indexOf('CREATE OR REPLACE FUNCTION public.sync_phone_line_check_config_v1'),
    )
    const floor = Number(unitCost.match(/greatest\(cost,\s*([0-9.]+)\)/)?.[1])
    expect(floor).toBe(0.015)
    const reserve = review.slice(
      review.indexOf('CREATE OR REPLACE FUNCTION public.reserve_phone_line_check_candidates_v1'),
      review.indexOf('CREATE OR REPLACE FUNCTION public.select_phone_line_check_candidates_v1'),
    )
    const apply = review.slice(
      review.indexOf('CREATE OR REPLACE FUNCTION public.apply_phone_line_checks_v1'),
      review.indexOf('CREATE OR REPLACE FUNCTION public.reserve_phone_line_check_candidates_v1'),
    )
    expect(reserve).toContain('v_cost := public.phone_line_check_unit_cost_v1()')
    expect(reserve).toContain('/ v_cost')
    expect(apply).toContain('v_cost := public.phone_line_check_unit_cost_v1()')
    expect(apply).toContain('v_cost, p_source, v_actor')

    const floorMills = Math.round(floor * 10000)
    let widest = 0
    for (let mills = 1; mills <= 10000; mills += 1) {
      const unitMills = Math.max(mills, floorMills)
      const byDay = Math.floor((15 * 10000) / unitMills)
      const byMonth = Math.floor((60 * 10000) / unitMills)
      const granted = Math.min(1500, byDay, byMonth)
      expect(granted).toBeLessThanOrEqual(1000)
      widest = Math.max(widest, granted)
    }
    expect(widest).toBe(1000)
    const reproMills = Math.max(Math.round(0.001 * 10000), floorMills)
    expect(Math.min(1500, Math.floor((15 * 10000) / reproMills))).toBe(1000)
  })
})
