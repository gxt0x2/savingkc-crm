-- Sprint 2 S2-02: Denormalized query columns for appointment worker
-- These enable efficient queries without parsing JSONB

ALTER TABLE manifests ADD COLUMN IF NOT EXISTS next_appointment_at TIMESTAMPTZ;
ALTER TABLE manifests ADD COLUMN IF NOT EXISTS appointment_status TEXT;

-- Index for the reminder worker query
CREATE INDEX IF NOT EXISTS idx_manifests_appointment
  ON manifests (appointment_status, next_appointment_at)
  WHERE appointment_status IS NOT NULL;

-- Backfill existing appointment data
UPDATE manifests
SET
  next_appointment_at = (manifest->'pipeline'->'appointment'->>'scheduledAt')::timestamptz,
  appointment_status = manifest->'pipeline'->'appointment'->>'status'
WHERE manifest->'pipeline'->'appointment' IS NOT NULL;
