-- ============================================================
-- DISPOSITION PLATFORM: Buyer Database + Deal Broadcasting
-- ============================================================

-- ============================================================
-- TABLE: buyers
-- Core buyer database - cash buyers for deal disposition
-- ============================================================
CREATE TABLE IF NOT EXISTS buyers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Contact info
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  phone_2 TEXT,

  -- Buy box criteria (JSONB for flexible matching)
  buy_box JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Financial capacity
  funding_type TEXT,
  max_purchase_price NUMERIC,
  monthly_capacity INTEGER,
  avg_close_days INTEGER,
  proof_of_funds BOOLEAN DEFAULT false,

  -- Relationship
  status TEXT NOT NULL DEFAULT 'active',
  tier TEXT DEFAULT 'standard',
  source TEXT,
  deals_closed INTEGER DEFAULT 0,
  last_deal_date TIMESTAMPTZ,

  -- Communication preferences
  sms_opted_in BOOLEAN DEFAULT true,
  email_opted_in BOOLEAN DEFAULT true,
  preferred_contact TEXT DEFAULT 'sms',

  -- Notes
  notes TEXT,
  tags TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_buyers_status ON buyers(status) WHERE status = 'active';
CREATE INDEX idx_buyers_buy_box_gin ON buyers USING GIN (buy_box jsonb_path_ops);
CREATE INDEX idx_buyers_phone ON buyers(phone);
CREATE INDEX idx_buyers_email ON buyers(email);
CREATE INDEX idx_buyers_tier ON buyers(tier);
CREATE INDEX idx_buyers_tags ON buyers USING GIN (tags);

-- ============================================================
-- TABLE: deal_broadcasts
-- A broadcast event: one deal sent to matched buyers
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_broadcasts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'draft',
  broadcast_type TEXT NOT NULL DEFAULT 'auto_match',

  deal_snapshot JSONB NOT NULL DEFAULT '{}',
  match_criteria JSONB DEFAULT '{}',

  -- Stats (denormalized)
  total_recipients INTEGER DEFAULT 0,
  sms_sent INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  sms_replies INTEGER DEFAULT 0,
  email_opens INTEGER DEFAULT 0,
  email_clicks INTEGER DEFAULT 0,
  offers_received INTEGER DEFAULT 0,

  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by TEXT DEFAULT 'system',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_broadcasts_lead ON deal_broadcasts(lead_id);
CREATE INDEX idx_broadcasts_status ON deal_broadcasts(status);
CREATE INDEX idx_broadcasts_sent ON deal_broadcasts(sent_at DESC);

-- ============================================================
-- TABLE: broadcast_recipients
-- Individual send record per buyer per broadcast
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_id UUID NOT NULL REFERENCES deal_broadcasts(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,

  sms_status TEXT DEFAULT 'pending',
  sms_sid TEXT,
  sms_sent_at TIMESTAMPTZ,
  sms_from TEXT,

  email_status TEXT DEFAULT 'pending',
  email_id TEXT,
  email_sent_at TIMESTAMPTZ,

  sms_replied BOOLEAN DEFAULT false,
  sms_reply_text TEXT,
  sms_reply_at TIMESTAMPTZ,

  email_opened_at TIMESTAMPTZ,
  email_clicked_at TIMESTAMPTZ,

  match_score INTEGER DEFAULT 0,
  match_reasons TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recipients_broadcast ON broadcast_recipients(broadcast_id);
CREATE INDEX idx_recipients_buyer ON broadcast_recipients(buyer_id);
CREATE INDEX idx_recipients_sms_status ON broadcast_recipients(sms_status);
CREATE INDEX idx_recipients_email_status ON broadcast_recipients(email_status);
CREATE UNIQUE INDEX idx_recipients_unique ON broadcast_recipients(broadcast_id, buyer_id);

-- ============================================================
-- TABLE: buyer_offers
-- ============================================================
CREATE TABLE IF NOT EXISTS buyer_offers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  broadcast_id UUID REFERENCES deal_broadcasts(id) ON DELETE SET NULL,

  offer_amount NUMERIC NOT NULL,
  earnest_money NUMERIC,
  close_days INTEGER,
  inspection_days INTEGER,
  financing_type TEXT,
  contingencies TEXT,
  notes TEXT,

  status TEXT NOT NULL DEFAULT 'submitted',
  counter_amount NUMERIC,
  counter_notes TEXT,

  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offers_lead ON buyer_offers(lead_id);
CREATE INDEX idx_offers_buyer ON buyer_offers(buyer_id);
CREATE INDEX idx_offers_status ON buyer_offers(status);
CREATE INDEX idx_offers_broadcast ON buyer_offers(broadcast_id);

-- ============================================================
-- TABLE: deal_pages
-- Public shareable deal detail pages
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  slug TEXT NOT NULL UNIQUE,

  title TEXT,
  description TEXT,
  photos TEXT[] DEFAULT '{}',

  show_address BOOLEAN DEFAULT true,
  show_arv BOOLEAN DEFAULT true,
  show_repair_estimate BOOLEAN DEFAULT true,
  show_asking_price BOOLEAN DEFAULT true,
  show_assignment_fee BOOLEAN DEFAULT false,
  show_photos BOOLEAN DEFAULT true,

  is_active BOOLEAN DEFAULT true,
  requires_registration BOOLEAN DEFAULT false,
  password TEXT,

  view_count INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,

  accept_offers BOOLEAN DEFAULT true,
  offer_deadline TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deal_pages_slug ON deal_pages(slug);
CREATE INDEX idx_deal_pages_lead ON deal_pages(lead_id);
CREATE INDEX idx_deal_pages_active ON deal_pages(is_active) WHERE is_active = true;

-- ============================================================
-- TABLE: deal_page_views
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_page_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_page_id UUID NOT NULL REFERENCES deal_pages(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,

  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  source TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_page_views_page ON deal_page_views(deal_page_id);
CREATE INDEX idx_page_views_buyer ON deal_page_views(buyer_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'buyers_updated_at') THEN
    CREATE TRIGGER buyers_updated_at BEFORE UPDATE ON buyers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deal_broadcasts_updated_at') THEN
    CREATE TRIGGER deal_broadcasts_updated_at BEFORE UPDATE ON deal_broadcasts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'buyer_offers_updated_at') THEN
    CREATE TRIGGER buyer_offers_updated_at BEFORE UPDATE ON buyer_offers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deal_pages_updated_at') THEN
    CREATE TRIGGER deal_pages_updated_at BEFORE UPDATE ON deal_pages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on buyers"
  ON buyers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated read on buyers"
  ON buyers FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access on deal_broadcasts"
  ON deal_broadcasts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated read on deal_broadcasts"
  ON deal_broadcasts FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access on broadcast_recipients"
  ON broadcast_recipients FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated read on broadcast_recipients"
  ON broadcast_recipients FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access on buyer_offers"
  ON buyer_offers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated read on buyer_offers"
  ON buyer_offers FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access on deal_pages"
  ON deal_pages FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated read on deal_pages"
  ON deal_pages FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access on deal_page_views"
  ON deal_page_views FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Authenticated read on deal_page_views"
  ON deal_page_views FOR SELECT USING (auth.role() = 'authenticated');
