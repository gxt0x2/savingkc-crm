-- Track DocuSeal assignment contract state per offer. When an offer is
-- accepted and the user clicks "Send Assignment", we create a DocuSeal
-- submission and store the id + timestamps here so we can show status
-- badges and avoid double-sends.
ALTER TABLE buyer_offers
  ADD COLUMN IF NOT EXISTS assignment_submission_id TEXT,
  ADD COLUMN IF NOT EXISTS assignment_assignee_submitter_id TEXT,
  ADD COLUMN IF NOT EXISTS assignment_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_document_url TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_assignment_submission
  ON buyer_offers(assignment_submission_id)
  WHERE assignment_submission_id IS NOT NULL;
