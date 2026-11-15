#!/usr/bin/env bash
# Applies the call-recording archive migration on a throwaway Postgres and
# writes a realistic Mojo recording URL longer than 255 characters.
# Does not connect to Atlas and does not change an existing recordings bucket.
set -euo pipefail

PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261217120000_call_recording_archive.sql"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-recording-archive.XXXXXX)"
PG_PORT="$((58400 + $$ % 300))"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_DIR"
}
trap cleanup EXIT

mkdir -p "$REHEARSAL_DIR/socket"
"$PG_BIN/initdb" -D "$REHEARSAL_DIR/data" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -o "-F -p $PG_PORT -k $REHEARSAL_DIR/socket -h ''" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$REHEARSAL_DIR/socket" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" >/dev/null <<'SQL'
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', false, 52428800, ARRAY['audio/mpeg']);

CREATE TABLE public.crm_mojo_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_at timestamptz NOT NULL DEFAULT now(),
  recording_url text,
  recording_storage_path text
);
CREATE TABLE public.crm_mojo_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_at timestamptz NOT NULL DEFAULT now(),
  is_recorded boolean
);
CREATE TABLE public.dialer_session_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  recording_sid text
);
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metadata jsonb
);
INSERT INTO public.lead_activities (id, metadata)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  jsonb_build_object(
    'recordingUrl',
    'https://example.supabase.co/storage/v1/object/public/recordings/leads/11111111-1111-4111-8111-111111111111/call.mp3'
  )
);
SQL

"${PSQL[@]}" -f "$MIGRATION" >/dev/null

PREFIX='https://app71.mojosells.com/v2/rest/call-recordings/'
INSERT_URL="${PREFIX}$(printf 'a%.0s' $(seq 1 280)).mp3"
UPDATE_URL="${PREFIX}$(printf 'b%.0s' $(seq 1 320)).mp3"

"${PSQL[@]}" \
  --set=insert_url="$INSERT_URL" \
  --set=update_url="$UPDATE_URL" \
  <<'SQL'
INSERT INTO public.crm_mojo_calls (id, is_recorded, recording_url)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, :'insert_url');

UPDATE public.crm_mojo_calls
SET recording_url = :'update_url'
WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SQL

RESULT="$("${PSQL[@]}" -tA --set=update_url="$UPDATE_URL" <<'SQL'
SELECT 'insert=ok update=ok'
  || ' recording_url_length=' || char_length(recording_url)
  FROM public.crm_mojo_calls
 WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
   AND recording_url = :'update_url'
   AND recording_url ~ '^[^[:space:]]+$'
   AND char_length(recording_url) > 255
   AND char_length(recording_url) <= 1800;
SQL
)"

ENCODED="$("${PSQL[@]}" -tA <<'SQL'
SELECT metadata->>'recordingUrl'
FROM public.lead_activities
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SQL
)"

if [[ "$RESULT" != insert=ok\ update=ok\ recording_url_length=* ]]; then
  echo "recording archive rehearsal failed: $RESULT" >&2
  exit 1
fi
if [[ "$ENCODED" != '/api/recordings?path=leads%2F11111111-1111-4111-8111-111111111111%2Fcall.mp3' ]]; then
  echo "recording path was not URL-encoded: $ENCODED" >&2
  exit 1
fi
BUCKET_LIMIT="$("${PSQL[@]}" -tA -c "SELECT file_size_limit FROM storage.buckets WHERE id = 'recordings'")"
if [[ "$BUCKET_LIMIT" != "52428800" ]]; then
  echo "existing recordings bucket settings changed: $BUCKET_LIMIT" >&2
  exit 1
fi
echo "$RESULT"
echo "insert_length=${#INSERT_URL}"
echo "update_length=${#UPDATE_URL}"
echo "encoded_path=ok"
