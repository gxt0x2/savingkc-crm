-- Manual document attachments for leads, offers, buyers, and deals.
-- Physical files live in the 'deal-documents' Storage bucket; this table
-- tracks metadata + which entity each doc belongs to.
CREATE TABLE IF NOT EXISTS documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead','offer','buyer','deal','dispo_deal')),
  entity_id UUID NOT NULL,
  doc_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  byte_size BIGINT,
  notes TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at DESC);

-- Private storage bucket (50 MB per file). Our API signs URLs for download
-- so the bucket stays private; no public-read policies added on purpose.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('deal-documents', 'deal-documents', false, 52428800)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;
