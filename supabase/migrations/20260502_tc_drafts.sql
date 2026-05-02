-- Durable draft approvals for the transaction coordinator queue.

CREATE TABLE IF NOT EXISTS tc_drafts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tc_file_id UUID NOT NULL REFERENCES tc_files(id) ON DELETE CASCADE,
  template_id UUID REFERENCES tc_document_templates(id) ON DELETE SET NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'document', 'sms')),
  recipient_role TEXT NOT NULL
    CHECK (recipient_role IN ('buyer', 'seller', 'title', 'internal')),
  recipient_email TEXT,
  recipient_phone TEXT,
  subject TEXT,
  draft_body TEXT NOT NULL,
  edited_body TEXT,
  approved_body TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'superseded')),
  rejection_notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tc_drafts_file_status
  ON tc_drafts(tc_file_id, status);
CREATE INDEX IF NOT EXISTS idx_tc_drafts_lead
  ON tc_drafts(lead_id);
CREATE INDEX IF NOT EXISTS idx_tc_drafts_template
  ON tc_drafts(template_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_drafts_unique_pending_template
  ON tc_drafts(tc_file_id, template_id)
  WHERE status = 'pending' AND template_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tc_drafts_updated_at') THEN
    CREATE TRIGGER tc_drafts_updated_at BEFORE UPDATE ON tc_drafts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
