
-- Prospects: one row per property/tax record
CREATE TABLE IF NOT EXISTS prospects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parcel_id TEXT,
  county TEXT NOT NULL,
  
  -- Property (situs) address
  situs_address TEXT,
  situs_street TEXT,
  situs_city TEXT,
  situs_state TEXT,
  situs_zip TEXT,
  
  -- Owner info
  owner_1 TEXT,
  owner_1_first TEXT,
  owner_1_last TEXT,
  owner_1_type TEXT,
  
  -- Mailing address
  mailing_street TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  
  -- Tax data
  cumulative_due NUMERIC,
  earliest_delinquent_year INTEGER,
  delinquent_years_category TEXT,
  
  -- Valuation
  total_market_value NUMERIC,
  zestimate NUMERIC,
  
  -- Flags
  occupancy_status TEXT,
  is_deceased BOOLEAN DEFAULT FALSE,
  is_skip_traced BOOLEAN DEFAULT FALSE,
  owner_age INTEGER,
  
  -- Emails (first 2)
  email_1 TEXT,
  email_2 TEXT,
  
  -- Link to CRM lead (set when prospect becomes a lead)
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospects_parcel ON prospects(parcel_id);
CREATE INDEX IF NOT EXISTS idx_prospects_county ON prospects(county);
CREATE INDEX IF NOT EXISTS idx_prospects_lead_id ON prospects(lead_id);
CREATE INDEX IF NOT EXISTS idx_prospects_situs_address ON prospects(situs_street);

-- Prospect phones: one row per phone number, linked to prospect
CREATE TABLE IF NOT EXISTS prospect_phones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  phone_type TEXT,
  phone_connected TEXT,
  contact_name TEXT,
  relationship TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_phones_phone ON prospect_phones(phone);
CREATE INDEX IF NOT EXISTS idx_prospect_phones_prospect ON prospect_phones(prospect_id);
