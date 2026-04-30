-- Persist call-wizard options for saved dialer lists.

ALTER TABLE dialer_saved_lists
  ADD COLUMN IF NOT EXISTS caller_mode TEXT NOT NULL DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS rotation_caller_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rotate_every_calls INTEGER NOT NULL DEFAULT 50 CHECK (rotate_every_calls >= 1),
  ADD COLUMN IF NOT EXISTS redial_caller_id TEXT,
  ADD COLUMN IF NOT EXISTS start_behavior TEXT NOT NULL DEFAULT 'resume',
  ADD COLUMN IF NOT EXISTS optional_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS call_hammer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicemail_call_hammer BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dialer_saved_lists_caller_mode_check'
  ) THEN
    ALTER TABLE dialer_saved_lists
      ADD CONSTRAINT dialer_saved_lists_caller_mode_check
      CHECK (caller_mode IN ('static', 'rotation'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dialer_saved_lists_rotation_caller_ids_array_check'
  ) THEN
    ALTER TABLE dialer_saved_lists
      ADD CONSTRAINT dialer_saved_lists_rotation_caller_ids_array_check
      CHECK (jsonb_typeof(rotation_caller_ids) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dialer_saved_lists_start_behavior_check'
  ) THEN
    ALTER TABLE dialer_saved_lists
      ADD CONSTRAINT dialer_saved_lists_start_behavior_check
      CHECK (start_behavior IN ('resume', 'top'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dialer_saved_lists_optional_filters_object_check'
  ) THEN
    ALTER TABLE dialer_saved_lists
      ADD CONSTRAINT dialer_saved_lists_optional_filters_object_check
      CHECK (jsonb_typeof(optional_filters) = 'object');
  END IF;
END $$;
