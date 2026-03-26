-- Savings KC CRM Schema
-- Extends existing Ari tables with CRM-specific fields

-- Personality type enum
CREATE TYPE personality_type AS ENUM ('assertive', 'analytical', 'amiable', 'accommodator', 'expressive');
CREATE TYPE deal_stage AS ENUM ('new', 'not_contacted', 'contacted', 'qualifying', 'appt_set', 'negotiations', 'contract_signed');
CREATE TYPE activity_type AS ENUM ('call', 'sms', 'email', 'status_change');
CREATE TYPE activity_direction AS ENUM ('in', 'out');
CREATE TYPE task_type AS ENUM ('follow_up', 'appointment', 'send_offer', 'review', 'task');
CREATE TYPE task_status AS ENUM ('pending', 'completed', 'overdue');
CREATE TYPE checklist_protocol AS ENUM ('sod', 'eod');

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  personality_type personality_type,
  lead_score INTEGER DEFAULT 0,
  lead_owner TEXT,
  smart_tags TEXT[] DEFAULT '{}',
  current_stage deal_stage DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Deals table
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  property_address TEXT,
  stage deal_stage DEFAULT 'new',
  arv NUMERIC,
  as_is_value NUMERIC,
  asking_price NUMERIC,
  equity NUMERIC,
  debt_total NUMERIC,
  est_assignment NUMERIC,
  ari_insight TEXT,
  ari_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Activities table
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  type activity_type NOT NULL,
  direction activity_direction,
  content TEXT,
  outcome TEXT,
  duration INTEGER,
  sentiment TEXT,
  ai_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type task_type NOT NULL DEFAULT 'task',
  title TEXT NOT NULL,
  description TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  property_address TEXT,
  due_date TIMESTAMPTZ,
  assigned_to TEXT,
  status task_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Checklist submissions
CREATE TABLE IF NOT EXISTS checklist_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_type checklist_protocol NOT NULL,
  team_member TEXT NOT NULL,
  status TEXT DEFAULT 'submitted',
  notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- EOD Reflections
CREATE TABLE IF NOT EXISTS eod_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unexpected TEXT,
  went_right TEXT,
  lesson_learned TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- Call sessions
CREATE TABLE IF NOT EXISTS call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  direction activity_direction NOT NULL DEFAULT 'out',
  status TEXT DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration INTEGER,
  recording_url TEXT
);

-- Indexes
CREATE INDEX idx_deals_contact ON deals(contact_id);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_activities_contact ON activities(contact_id);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_contacts_stage ON contacts(current_stage);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER deals_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
