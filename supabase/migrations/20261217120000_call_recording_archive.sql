-- Retain every Mojo and Twilio call recording in private storage.
-- Columns are nullable and additive. No existing functions are replaced.
-- An existing recordings bucket is left untouched, including its public flag,
-- size limit, and allowed mime types.

ALTER TABLE public.crm_mojo_calls
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS recording_storage_path text,
  ADD COLUMN IF NOT EXISTS recording_copied_at timestamptz;

ALTER TABLE public.crm_mojo_calls
  DROP CONSTRAINT IF EXISTS crm_mojo_calls_recording_url_check,
  ADD CONSTRAINT crm_mojo_calls_recording_url_check
    CHECK (
      recording_url IS NULL
      OR (
        recording_url ~ '^[^[:space:]]+$'
        AND char_length(recording_url) <= 1800
      )
    ) NOT VALID;

ALTER TABLE public.crm_mojo_calls
  DROP CONSTRAINT IF EXISTS crm_mojo_calls_recording_storage_path_check,
  ADD CONSTRAINT crm_mojo_calls_recording_storage_path_check
    CHECK (
      recording_storage_path IS NULL
      OR (
        char_length(recording_storage_path) BETWEEN 5 AND 240
        AND recording_storage_path !~ '\.\.'
        AND recording_storage_path !~ '^/'
      )
    ) NOT VALID;

ALTER TABLE public.dialer_session_attempts
  ADD COLUMN IF NOT EXISTS recording_storage_path text,
  ADD COLUMN IF NOT EXISTS recording_copied_at timestamptz;

ALTER TABLE public.dialer_session_attempts
  DROP CONSTRAINT IF EXISTS dialer_session_attempts_recording_storage_path_check,
  ADD CONSTRAINT dialer_session_attempts_recording_storage_path_check
    CHECK (
      recording_storage_path IS NULL
      OR (
        char_length(recording_storage_path) BETWEEN 5 AND 240
        AND recording_storage_path !~ '\.\.'
        AND recording_storage_path !~ '^/'
      )
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_recording_archive
  ON public.crm_mojo_call_events (call_at, id)
  WHERE recording_url IS NOT NULL
    AND recording_storage_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_recording_archive
  ON public.crm_mojo_calls (call_at, id)
  WHERE recording_storage_path IS NULL
    AND (recording_url IS NOT NULL OR is_recorded IS TRUE);

CREATE INDEX IF NOT EXISTS idx_dialer_session_attempts_recording_archive
  ON public.dialer_session_attempts (created_at, id)
  WHERE recording_sid IS NOT NULL
    AND recording_storage_path IS NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recordings',
  'recordings',
  false,
  104857600,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
)
ON CONFLICT (id) DO NOTHING;

-- Point stored private-bucket links at the signed playback route. The path is
-- URL-encoded so slashes stay inside the query value.
UPDATE public.lead_activities
SET metadata = jsonb_set(
  metadata,
  '{recordingUrl}',
  to_jsonb(
    '/api/recordings?path=' || replace(
      substring(
        metadata->>'recordingUrl'
        FROM '/storage/v1/object/public/recordings/([A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(?:mp3|wav))'
      ),
      '/',
      '%2F'
    )
  )
)
WHERE coalesce(metadata->>'recordingUrl', '') ~ '/storage/v1/object/public/recordings/[A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(mp3|wav)';

UPDATE public.lead_activities
SET metadata = jsonb_set(
  metadata,
  '{recording_url}',
  to_jsonb(
    '/api/recordings?path=' || replace(
      substring(
        metadata->>'recording_url'
        FROM '/storage/v1/object/public/recordings/([A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(?:mp3|wav))'
      ),
      '/',
      '%2F'
    )
  )
)
WHERE coalesce(metadata->>'recording_url', '') ~ '/storage/v1/object/public/recordings/[A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(mp3|wav)';

UPDATE public.lead_activities
SET metadata = jsonb_set(
  metadata,
  '{RecordingUrl}',
  to_jsonb(
    '/api/recordings?path=' || replace(
      substring(
        metadata->>'RecordingUrl'
        FROM '/storage/v1/object/public/recordings/([A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(?:mp3|wav))'
      ),
      '/',
      '%2F'
    )
  )
)
WHERE coalesce(metadata->>'RecordingUrl', '') ~ '/storage/v1/object/public/recordings/[A-Za-z0-9][A-Za-z0-9/_.-]{0,220}\.(mp3|wav)';
