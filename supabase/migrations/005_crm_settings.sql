-- Settings table for persistent CRM configuration (profile pics, agent settings, etc.)
CREATE TABLE IF NOT EXISTS crm_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow service role full access
ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON crm_settings FOR ALL USING (true) WITH CHECK (true);
