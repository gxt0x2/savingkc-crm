-- Step 4 of demote-the-manifest plan.
-- Briefings and co-owners get their own relational tables. Manifest writers
-- continue dual-writing for now; readers prefer relational, fall back to
-- manifest for legacy data.

CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  situation TEXT,
  motivation TEXT,
  strategy TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by TEXT NOT NULL DEFAULT 'system:ari',
  generated_from JSONB,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefings_lead ON briefings(lead_id);
CREATE INDEX IF NOT EXISTS idx_briefings_lead_current ON briefings(lead_id, is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_briefings_generated_at ON briefings(generated_at DESC);

CREATE TABLE IF NOT EXISTS lead_co_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'ai_extraction'
    CHECK (source IN ('ai_extraction','manual','county_records')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lead_co_owners_lead ON lead_co_owners(lead_id);

COMMENT ON TABLE briefings IS 'Per-lead AI briefings (situation/motivation/strategy). is_current=true marks the latest.';
COMMENT ON TABLE lead_co_owners IS 'Co-owners associated with a lead. Replaces manifest.coOwners / manifest.owner.coOwners.';
