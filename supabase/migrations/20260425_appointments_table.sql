-- Step 2 of demote-the-manifest plan.
-- Dedicated appointments table replaces the single leads.appointment_date slot
-- so we can keep history, query "next 7 days", and stop two writers from
-- racing on one column. Lead row stays as a denormalized cache of the next
-- upcoming appointment.

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL DEFAULT 'phone_call'
    CHECK (type IN ('phone_call','in_person','google_meet','onsite','virtual')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','completed','no_show','cancelled','rescheduled')),
  address TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','crm_call','mojo_sync','ai_extraction','calendar_sync')),
  source_call_id TEXT,
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_lead ON appointments(lead_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_lead_scheduled ON appointments(lead_id, scheduled_at);

-- Backfill from existing leads.appointment_date so nothing is lost.
INSERT INTO appointments (lead_id, scheduled_at, type, status, notes, source)
SELECT
  id,
  appointment_date,
  'phone_call',
  'scheduled',
  appointment_notes,
  'ai_extraction'
FROM leads
WHERE appointment_date IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE appointments IS 'Seller appointments per lead. Source of truth for "next confirmed appointment" — supersedes manifest.pipeline.appointment.';
