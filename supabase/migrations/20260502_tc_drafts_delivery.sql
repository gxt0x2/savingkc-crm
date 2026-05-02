-- Delivery controls and audit metadata for approved TC drafts.

ALTER TABLE tc_drafts
  DROP CONSTRAINT IF EXISTS tc_drafts_status_check;

ALTER TABLE tc_drafts
  ADD CONSTRAINT tc_drafts_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'sending', 'sent', 'superseded'));

ALTER TABLE tc_drafts
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by TEXT,
  ADD COLUMN IF NOT EXISTS delivery_provider TEXT,
  ADD COLUMN IF NOT EXISTS delivery_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_tc_drafts_delivery_started
  ON tc_drafts(delivery_started_at)
  WHERE status = 'sending';
