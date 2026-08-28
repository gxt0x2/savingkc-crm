-- Durable, private archive for Mojo call recordings admitted into the
-- canonical CRM call ledger. The provider URL remains immutable evidence;
-- the archived object is the playback source owned by SavingKC.

ALTER TABLE public.crm_mojo_call_events
  ADD COLUMN IF NOT EXISTS recording_storage_path text,
  ADD COLUMN IF NOT EXISTS recording_mime_type text,
  ADD COLUMN IF NOT EXISTS recording_byte_size bigint,
  ADD COLUMN IF NOT EXISTS recording_sha256 text,
  ADD COLUMN IF NOT EXISTS recording_archived_at timestamptz;

ALTER TABLE public.crm_mojo_call_events
  DROP CONSTRAINT IF EXISTS crm_mojo_call_events_recording_archive_check;

ALTER TABLE public.crm_mojo_call_events
  ADD CONSTRAINT crm_mojo_call_events_recording_archive_check CHECK (
    recording_storage_path IS NULL
    OR (
      recording_storage_path ~ '^mojo/[0-9a-f-]{36}\.mp3$'
      AND recording_mime_type = 'audio/mpeg'
      AND recording_byte_size BETWEEN 1000 AND 104857600
      AND recording_sha256 ~ '^[0-9a-f]{64}$'
      AND recording_archived_at IS NOT NULL
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('mojo-call-recordings', 'mojo-call-recordings', false, 104857600)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

CREATE OR REPLACE FUNCTION public.archive_crm_mojo_recording_v1(
  p_event_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_row public.crm_mojo_call_events;
  playback_url text := '/api/recordings/mojo/' || p_event_id::text;
  recording_sid text := 'MOJO-' || replace(p_event_id::text, '-', '');
  was_archived boolean := false;
BEGIN
  IF p_storage_path IS DISTINCT FROM ('mojo/' || p_event_id::text || '.mp3')
    OR p_mime_type IS DISTINCT FROM 'audio/mpeg'
    OR p_byte_size NOT BETWEEN 1000 AND 104857600
    OR p_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'invalid_mojo_recording_archive';
  END IF;

  SELECT * INTO event_row
  FROM public.crm_mojo_call_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF event_row.id IS NULL OR event_row.recording_url IS NULL THEN
    RAISE EXCEPTION 'mojo_recording_event_not_found';
  END IF;
  was_archived := event_row.recording_storage_path IS NOT NULL;

  UPDATE public.crm_mojo_call_events
  SET recording_storage_path = p_storage_path,
      recording_mime_type = p_mime_type,
      recording_byte_size = p_byte_size,
      recording_sha256 = p_sha256,
      recording_archived_at = coalesce(recording_archived_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE id = p_event_id
  RETURNING * INTO event_row;

  IF event_row.activity_id IS NOT NULL THEN
    UPDATE public.lead_activities
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'recordingUrl', playback_url,
      'recordingSourceUrl', event_row.recording_url,
      'recordingSid', recording_sid,
      'recordingDuration', event_row.duration_seconds,
      'recordingProvider', 'mojo',
      'recordingArchivedAt', event_row.recording_archived_at,
      'recordingSha256', p_sha256
    )
    WHERE id = event_row.activity_id;
  END IF;

  RETURN jsonb_build_object(
    'eventId', event_row.id,
    'activityId', event_row.activity_id,
    'storagePath', event_row.recording_storage_path,
    'playbackUrl', playback_url,
    'archivedAt', event_row.recording_archived_at,
    'replayed', was_archived
  );
END;
$$;

REVOKE ALL ON FUNCTION public.archive_crm_mojo_recording_v1(uuid, text, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_crm_mojo_recording_v1(uuid, text, text, bigint, text)
  TO service_role;

COMMENT ON COLUMN public.crm_mojo_call_events.recording_url IS
  'Immutable Mojo provider source URL; never exposed directly to CRM browsers.';
COMMENT ON COLUMN public.crm_mojo_call_events.recording_storage_path IS
  'Private SavingKC-owned Supabase Storage object for durable call playback.';

NOTIFY pgrst, 'reload schema';
