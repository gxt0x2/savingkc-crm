-- Title company / transaction coordinator workflow for assigned deals.

CREATE TABLE IF NOT EXISTS title_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  office_phone TEXT,
  office_email TEXT,
  address TEXT,
  preferred BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_title_companies_name_lower
  ON title_companies (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_title_companies_preferred
  ON title_companies(preferred)
  WHERE preferred = true;

CREATE TABLE IF NOT EXISTS title_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title_company_id UUID NOT NULL REFERENCES title_companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_title_contacts_company
  ON title_contacts(title_company_id);
CREATE INDEX IF NOT EXISTS idx_title_contacts_primary
  ON title_contacts(title_company_id, is_primary)
  WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS tc_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  dispo_deal_id UUID REFERENCES dispo_deals(id) ON DELETE SET NULL,
  buyer_offer_id UUID REFERENCES buyer_offers(id) ON DELETE SET NULL,
  title_company_id UUID REFERENCES title_companies(id) ON DELETE SET NULL,
  title_contact_id UUID REFERENCES title_contacts(id) ON DELETE SET NULL,
  file_number TEXT,
  status TEXT NOT NULL DEFAULT 'not_opened'
    CHECK (status IN (
      'not_opened',
      'opening_package_needed',
      'opened',
      'emd_pending',
      'title_work',
      'clear_to_close',
      'scheduled',
      'closed',
      'cancelled'
    )),
  opened_at TIMESTAMPTZ,
  emd_due_at TIMESTAMPTZ,
  emd_confirmed_at TIMESTAMPTZ,
  title_clear_at TIMESTAMPTZ,
  closing_scheduled_at TIMESTAMPTZ,
  closing_completed_at TIMESTAMPTZ,
  hud_received_at TIMESTAMPTZ,
  assignment_fee NUMERIC,
  revenue_logged_at TIMESTAMPTZ,
  next_action TEXT,
  risk_level TEXT NOT NULL DEFAULT 'normal'
    CHECK (risk_level IN ('normal', 'watch', 'urgent', 'blocked')),
  risk_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_files_lead ON tc_files(lead_id);
CREATE INDEX IF NOT EXISTS idx_tc_files_offer ON tc_files(buyer_offer_id);
CREATE INDEX IF NOT EXISTS idx_tc_files_dispo_deal ON tc_files(dispo_deal_id);
CREATE INDEX IF NOT EXISTS idx_tc_files_status ON tc_files(status);
CREATE INDEX IF NOT EXISTS idx_tc_files_risk ON tc_files(risk_level);
CREATE INDEX IF NOT EXISTS idx_tc_files_closing_scheduled ON tc_files(closing_scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_files_unique_offer
  ON tc_files(buyer_offer_id)
  WHERE buyer_offer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tc_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tc_file_id UUID NOT NULL REFERENCES tc_files(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'waived', 'blocked')),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_tasks_file ON tc_tasks(tc_file_id);
CREATE INDEX IF NOT EXISTS idx_tc_tasks_status ON tc_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tc_tasks_due ON tc_tasks(due_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_tasks_unique_type
  ON tc_tasks(tc_file_id, task_type);

CREATE TABLE IF NOT EXISTS tc_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tc_file_id UUID NOT NULL REFERENCES tc_files(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_events_file ON tc_events(tc_file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_events_type ON tc_events(event_type);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'title_companies_updated_at') THEN
    CREATE TRIGGER title_companies_updated_at BEFORE UPDATE ON title_companies
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'title_contacts_updated_at') THEN
    CREATE TRIGGER title_contacts_updated_at BEFORE UPDATE ON title_contacts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tc_files_updated_at') THEN
    CREATE TRIGGER tc_files_updated_at BEFORE UPDATE ON tc_files
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tc_tasks_updated_at') THEN
    CREATE TRIGGER tc_tasks_updated_at BEFORE UPDATE ON tc_tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
