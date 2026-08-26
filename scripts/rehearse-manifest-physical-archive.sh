#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-manifest-archive.XXXXXX)"
PG_PORT="$((58400 + $$ % 300))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
ROOT="$(pwd)"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-F -p $PG_PORT -k $PG_SOCKET" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" <<'SQL'
CREATE ROLE postgres SUPERUSER NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE cascade_writer NOLOGIN;
CREATE ROLE manifest_migrator NOLOGIN;

CREATE TABLE public.manifests (
  id uuid PRIMARY KEY,
  lead_id uuid,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.manifest_history (
  id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES public.manifests(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  diff jsonb NOT NULL,
  prior_hash text NOT NULL
);

CREATE TABLE public.ppc_conversion_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manifest_id uuid REFERENCES public.manifests(id) ON DELETE SET NULL
);

CREATE TABLE public.ppc_tracking_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manifest_id uuid REFERENCES public.manifests(id) ON DELETE SET NULL
);

CREATE FUNCTION public.contact_workspace_manifest_tags(jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[]::text[] $$;

CREATE FUNCTION public.contact_workspace_page_v1(
  text, text, integer, jsonb, text, text, text, text,
  text, text, text, text, text, text, text, timestamptz
) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'legacy-v1'::text $$;

CREATE FUNCTION public.contact_workspace_page_v2(
  text, text, integer, jsonb, text, text, text, text,
  text, text, text, text, text, text, text, timestamptz
) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'legacy-v2'::text $$;

ALTER FUNCTION public.contact_workspace_page_v2(
  text, text, integer, jsonb, text, text, text, text,
  text, text, text, text, text, text, text, timestamptz
) OWNER TO service_role;

GRANT EXECUTE ON FUNCTION public.contact_workspace_manifest_tags(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.contact_workspace_page_v1(
  text, text, integer, jsonb, text, text, text, text,
  text, text, text, text, text, text, text, timestamptz
) TO service_role;

GRANT SELECT ON public.manifests, public.manifest_history TO anon, authenticated, service_role;

INSERT INTO public.manifests (id, lead_id, manifest, created_at)
SELECT
  ('00000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  jsonb_build_object('fixture', item),
  '2026-08-23T20:22:10.446651Z'::timestamptz
FROM generate_series(1, 367) AS item;

INSERT INTO public.manifest_history (id, manifest_id, updated_at, actor, diff, prior_hash)
SELECT
  ('20000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((((item - 1) % 367) + 1)::text, 12, '0'))::uuid,
  '2026-08-23T20:22:10.446651Z'::timestamptz,
  'rehearsal',
  jsonb_build_object('fixture', item),
  repeat('a', 64)
FROM generate_series(1, 10668) AS item;

INSERT INTO public.ppc_conversion_outbox (manifest_id)
SELECT ('00000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid
FROM generate_series(1, 7) AS item;

INSERT INTO public.ppc_tracking_events (manifest_id)
SELECT ('00000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid
FROM generate_series(1, 8) AS item;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.manifests, public.manifest_history
  FROM PUBLIC, anon, authenticated, service_role, cascade_writer, manifest_migrator;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261020120000_manifest_physical_archive.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $test$
DECLARE
  outbox_target text;
  tracking_target text;
BEGIN
  IF to_regclass('public.manifests') IS NOT NULL
     OR to_regclass('public.manifest_history') IS NOT NULL
     OR to_regclass('manifest_archive.manifests') IS NULL
     OR to_regclass('manifest_archive.manifest_history') IS NULL
  THEN
    RAISE EXCEPTION 'rehearsal did not archive the two source tables';
  END IF;

  IF (SELECT count(*) FROM manifest_archive.manifests) <> 367
     OR (SELECT count(*) FROM manifest_archive.manifest_history) <> 10668
     OR (SELECT count(*) FROM public.ppc_conversion_outbox WHERE manifest_id IS NOT NULL) <> 7
     OR (SELECT count(*) FROM public.ppc_tracking_events WHERE manifest_id IS NOT NULL) <> 8
  THEN
    RAISE EXCEPTION 'rehearsal changed retained rows or PPC references';
  END IF;

  SELECT confrelid::regclass::text INTO outbox_target
  FROM pg_constraint
  WHERE conname = 'ppc_conversion_outbox_manifest_id_fkey';
  SELECT confrelid::regclass::text INTO tracking_target
  FROM pg_constraint
  WHERE conname = 'ppc_tracking_events_manifest_id_fkey';

  IF outbox_target <> 'manifest_archive.manifests'
     OR tracking_target <> 'manifest_archive.manifests'
  THEN
    RAISE EXCEPTION 'PPC foreign keys did not follow archive move';
  END IF;

  IF has_schema_privilege('anon', 'manifest_archive', 'USAGE')
     OR has_schema_privilege('authenticated', 'manifest_archive', 'USAGE')
     OR has_schema_privilege('service_role', 'manifest_archive', 'USAGE')
     OR has_table_privilege('service_role', 'manifest_archive.manifests', 'SELECT')
     OR has_function_privilege(
       'service_role',
       'public.contact_workspace_page_v1(text,text,integer,jsonb,text,text,text,text,text,text,text,text,text,text,text,timestamp with time zone)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'runtime access was not fully retired';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM manifest_archive.manifest_archive_receipts
    WHERE archive_id = 'savingkc-manifest-archive-2026-08-26T203409329Z'
      AND manifests_row_count = 367
      AND history_row_count = 10668
      AND manifests_sha256 = '2b22f25ce0307e1be09c03256a632729fc696233e65e4013b2c73f50a029cc7b'
      AND history_sha256 = '0bc2c67336d3ae1304e4957efb32176f5974ee2cc52c161e1b74e0c42bcb0dac'
      AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'verified receipt was not recorded';
  END IF;
END;
$test$;
SQL

"${PSQL[@]}" -f "$ROOT/scripts/archive/rollback-manifest-physical-archive.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $test$
BEGIN
  IF to_regclass('public.manifests') IS NULL
     OR to_regclass('public.manifest_history') IS NULL
     OR to_regclass('manifest_archive.manifests') IS NOT NULL
     OR to_regclass('manifest_archive.manifest_history') IS NOT NULL
  THEN
    RAISE EXCEPTION 'rehearsal rollback did not restore the source tables';
  END IF;

  IF (SELECT count(*) FROM public.manifests) <> 367
     OR (SELECT count(*) FROM public.manifest_history) <> 10668
     OR (SELECT count(*) FROM public.ppc_conversion_outbox WHERE manifest_id IS NOT NULL) <> 7
     OR (SELECT count(*) FROM public.ppc_tracking_events WHERE manifest_id IS NOT NULL) <> 8
  THEN
    RAISE EXCEPTION 'rollback changed retained rows or PPC references';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM manifest_archive.manifest_archive_receipts
    WHERE archive_id = 'savingkc-manifest-archive-2026-08-26T203409329Z'
      AND status = 'rolled_back'
      AND rolled_back_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'rollback was not recorded';
  END IF;

  IF has_table_privilege('service_role', 'public.manifests', 'INSERT')
     OR has_table_privilege('service_role', 'public.manifests', 'UPDATE')
     OR has_table_privilege('service_role', 'public.manifests', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.manifests', 'SELECT')
  THEN
    RAISE EXCEPTION 'rollback reopened a writer or failed to restore read-only access';
  END IF;
END;
$test$;
SQL

echo "Manifest physical archive and location rollback rehearsal passed"
