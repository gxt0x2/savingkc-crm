import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = join(root, 'supabase/migrations/20261222140001_remove_kansas_outreach_gates.sql')
const pgBin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()
const rehearsalDir = mkdtempSync(join(tmpdir(), 'savingkc-kansas-gate-'))
const port = 56000 + (process.pid % 1000)
const dataDir = join(rehearsalDir, 'data')
const socketDir = rehearsalDir

function psql(sql: string): string {
  return execFileSync(
    join(pgBin, 'psql'),
    ['-h', socketDir, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-At'],
    { encoding: 'utf8', input: sql },
  )
}

beforeAll(() => {
  execFileSync(join(pgBin, 'initdb'), ['-D', dataDir, '--no-locale', '-A', 'trust'], { stdio: 'ignore' })
  execFileSync(join(pgBin, 'pg_ctl'), [
    '-D', dataDir,
    '-o', `-F -p ${port} -k ${socketDir}`,
    '-w', 'start',
  ], { stdio: 'ignore' })
  psql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.prospects (
      id uuid PRIMARY KEY,
      county text,
      situs_state text,
      parcel_id text
    );
    CREATE TABLE public.target_zips (
      zip5 text PRIMARY KEY,
      county text,
      state text
    );
    CREATE TABLE public.source_list_dialer_phone_review (
      source_list_row_id uuid,
      list_type text,
      county text,
      state text,
      phone_e164 text
    );
    INSERT INTO public.source_list_dialer_phone_review VALUES
      ('00000000-0000-4000-8000-000000000001', 'mls_expired', 'johnson', 'KS', '+19135550100'),
      ('00000000-0000-4000-8000-000000000002', 'mls_expired', 'johnson', 'MO', '+18165550100');
    CREATE VIEW public.source_list_market_phone_review
    WITH (security_invoker = true) AS
    SELECT
      review.*,
      (
        upper(coalesce(review.state, '')) = 'KS'
        OR lower(coalesce(review.county, '')) IN ('wyandotte', 'johnson')
      ) AS ks_license_unconfirmed,
      (review.list_type = 'mls_expired') AS requires_licensee_disclosure
    FROM public.source_list_dialer_phone_review AS review;

    CREATE FUNCTION public.mls_config_flag_v1(p_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

    CREATE FUNCTION public.source_list_market_block_reason_v1(
      p_row_id uuid, p_parcel_id text, p_address text, p_prospect_id uuid, p_list_type text,
      p_phone_origin text DEFAULT NULL, p_phone text DEFAULT NULL
    ) RETURNS text
    LANGUAGE plpgsql STABLE AS $fn$
    DECLARE
      v_row_county text;
      v_row_state text;
      v_expired boolean := true;
    BEGIN
      IF v_expired THEN
    IF NOT public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
      AND (v_row_state = 'KS' OR v_row_county IN ('wyandotte', 'johnson')) THEN
      RETURN 'ks_license_unconfirmed';
    END IF;
      END IF;
      RETURN NULL;
    END;
    $fn$;

    CREATE FUNCTION public.source_list_phone_block_reasons_v1(
      p_phones text[], p_prospects uuid[], p_counties text[] DEFAULT NULL, p_situs_counties text[] DEFAULT NULL
    ) RETURNS TABLE(ordinal bigint, block_reason text)
    LANGUAGE sql STABLE AS $fn$
      WITH input AS (
        SELECT
          item.ordinal,
          item.prospect_id,
          counties.county,
          counties.situs_county
        FROM unnest(coalesce(p_phones, ARRAY[]::text[]), coalesce(p_prospects, ARRAY[]::uuid[]))
          WITH ORDINALITY AS item(phone, prospect_id, ordinal)
        LEFT JOIN unnest(
          coalesce(p_counties, ARRAY[]::text[]),
          coalesce(p_situs_counties, ARRAY[]::text[])
        ) WITH ORDINALITY AS counties(county, situs_county, ordinal)
          ON counties.ordinal = item.ordinal
      )
      SELECT input.ordinal,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM (VALUES (input.county), (input.situs_county)) AS candidate(county_value)
            CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(candidate.county_value)), '') AS slug) AS normalized
            WHERE normalized.slug IS NOT NULL
              AND normalized.slug NOT IN ('unknown', 'unresolved', 'jackson', 'clay', 'platte', 'wyandotte', 'johnson')
          ) THEN 'out_of_service_area'
          ELSE 'county_unresolved'
        END
      FROM input
      WHERE (p_counties IS NOT NULL OR p_situs_counties IS NOT NULL)
        AND (
          EXISTS (
            SELECT 1
            FROM (VALUES (input.county), (input.situs_county)) AS candidate(county_value)
            CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(candidate.county_value)), '') AS slug) AS normalized
            WHERE normalized.slug IS NOT NULL
              AND normalized.slug NOT IN ('unknown', 'unresolved', 'jackson', 'clay', 'platte', 'wyandotte', 'johnson')
          )
          OR NOT EXISTS (
            SELECT 1
            FROM (VALUES (input.county), (input.situs_county)) AS candidate(county_value)
            CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(candidate.county_value)), '') AS slug) AS normalized
            WHERE normalized.slug IN ('jackson', 'clay', 'platte', 'wyandotte', 'johnson')
          )
        );
    $fn$;

    CREATE FUNCTION public.record_source_list_export_batch_v1(
      p_actor text, p_list_type text DEFAULT NULL, p_county text DEFAULT NULL, p_state text DEFAULT NULL,
      p_violation_kind text DEFAULT NULL, p_source_list_id uuid DEFAULT NULL, p_line_mode integer DEFAULT 1
    ) RETURNS jsonb
    LANGUAGE plpgsql AS $fn$
    DECLARE
      v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
      v_county text := nullif(lower(btrim(coalesce(p_county, ''))), '');
      v_rows jsonb := '[]'::jsonb;
    BEGIN
  IF v_state IS NOT NULL AND v_state NOT IN ('MO', 'KS') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
      IF false THEN
        PERFORM 1 FROM (SELECT NULL::text AS state, NULL::text AS county, NULL::text AS block_reason,
          NULL::text AS phone_e164, NULL::text AS list_type, NULL::text AS parcel_id,
          NULL::uuid AS prospect_id, NULL::text AS phone_origin, true AS requires_licensee_disclosure,
          NULL::text AS phone_value) AS export_row
        WHERE export_row.block_reason IS NULL
          AND public.market_calling_window_open_v1()
          AND (
            public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
            OR (
              upper(coalesce(export_row.state, '')) <> 'KS'
              AND lower(coalesce(export_row.county, '')) NOT IN ('wyandotte', 'johnson')
            )
          )
          AND export_row.requires_licensee_disclosure IS TRUE
          AND export_row.prospect_id IS NOT NULL;
        PERFORM 1 FROM (SELECT NULL::text AS block_reason, true AS requires_licensee_disclosure,
          NULL::uuid AS prospect_id, NULL::text AS phone_origin, NULL::text AS phone_e164, NULL::text AS phone_value) AS review
        WHERE review.block_reason IS NOT NULL
              OR review.requires_licensee_disclosure IS DISTINCT FROM true
              OR review.prospect_id IS NULL
          AND (CASE WHEN review.requires_licensee_disclosure IS DISTINCT FROM true THEN 'licensee_disclosure_required' ELSE 'owner_match_missing' END) IS NOT NULL;
      END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rows) AS item
      WHERE coalesce((item->>'requires_licensee_disclosure')::boolean, false) IS DISTINCT FROM true
    ) THEN
      RAISE EXCEPTION 'licensee_disclosure_required';
    END IF;
      RETURN v_rows;
    END;
    $fn$;

    CREATE FUNCTION public.market_service_place_v1(p_zip text, p_parcel text)
    RETURNS TABLE(county text, state text)
    LANGUAGE sql STABLE AS $$ SELECT NULL::text, NULL::text $$;
  `)
  execFileSync(join(pgBin, 'psql'), [
    '-h', socketDir, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X',
    '-f', migrationPath,
  ], { stdio: 'pipe' })
})

afterAll(() => {
  try {
    execFileSync(join(pgBin, 'pg_ctl'), ['-D', dataDir, '-m', 'fast', 'stop'], { stdio: 'ignore' })
  } catch {
    // The cluster is already stopped.
  }
  rmSync(rehearsalDir, { recursive: true, force: true })
})

describe('kansas gate migration against a schema snapshot', () => {
  it('applies even when pg_get_viewdef pretty-prints the Kansas stamp', () => {
    const definition = psql("SELECT pg_get_viewdef('public.source_list_market_phone_review'::regclass, true);")
    const projected = definition.split(/\bFROM\b/i)[0]
    expect(projected.toLowerCase()).toContain('false as ks_license_unconfirmed')
    expect(projected).not.toContain("= 'KS'")
    const columns = psql(`
      SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'source_list_market_phone_review';
    `).trim()
    expect(columns).toBe('source_list_row_id,list_type,county,state,phone_e164,ks_license_unconfirmed,requires_licensee_disclosure')
    const flags = psql(`
      SELECT state || ':' || ks_license_unconfirmed::text
      FROM public.source_list_market_phone_review
      ORDER BY state;
    `).trim()
    expect(flags).toBe('KS:false\nMO:false')
  })

  it('does not block a Kansas county name unless the state is Kansas', () => {
    const prospect = '00000000-0000-4000-8000-000000000010'
    psql(`
      INSERT INTO public.prospects (id, county, situs_state, parcel_id)
      VALUES ('${prospect}', 'johnson', 'MO', 'PARCEL-JOHNSON-MO');
    `)
    const blocked = psql(`
      SELECT block_reason FROM public.source_list_phone_block_reasons_v1(
        ARRAY['+18165550101'],
        ARRAY['${prospect}'::uuid],
        ARRAY['johnson'],
        ARRAY[NULL]
      );
    `).trim()
    expect(blocked).toBe('out_of_service_area')
    psql(`UPDATE public.prospects SET situs_state = 'KS' WHERE id = '${prospect}';`)
    const allowed = psql(`
      SELECT count(*) FROM public.source_list_phone_block_reasons_v1(
        ARRAY['+18165550101'],
        ARRAY['${prospect}'::uuid],
        ARRAY['johnson'],
        ARRAY[NULL]
      );
    `).trim()
    expect(allowed).toBe('0')
    psql(`UPDATE public.prospects SET situs_state = NULL WHERE id = '${prospect}';`)
    const unqualified = psql(`
      SELECT block_reason FROM public.source_list_phone_block_reasons_v1(
        ARRAY['+18165550101'],
        ARRAY['${prospect}'::uuid],
        ARRAY['johnson'],
        ARRAY[NULL]
      );
    `).trim()
    expect(unqualified).toBe('out_of_service_area')
    psql(`UPDATE public.prospects SET situs_state = 'KS' WHERE id = '${prospect}';`)
    const place = psql(`
      SELECT coalesce(county, '') || '|' || coalesce(state, '')
      FROM public.market_service_place_v1(NULL, 'PARCEL-JOHNSON-MO');
    `).trim()
    expect(place).toBe('johnson|KS')
    psql(`UPDATE public.prospects SET situs_state = NULL WHERE id = '${prospect}';`)
    const missingState = psql(`
      SELECT coalesce(county, '') || '|' || coalesce(state, '')
      FROM public.market_service_place_v1(NULL, 'PARCEL-JOHNSON-MO');
    `).trim()
    expect(missingState).toBe('|')
  })

  it('does not change buyer contract templates', () => {
    expect(readFileSync(migrationPath, 'utf8')).not.toContain('tc_document_templates')
  })
})
