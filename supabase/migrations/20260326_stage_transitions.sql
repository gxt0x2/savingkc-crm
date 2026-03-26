-- ARI CRM - Stage Transitions Table
-- Night 3: Pipeline Brain
-- Tracks every stage change with full audit trail

CREATE TABLE IF NOT EXISTS stage_transitions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by TEXT NOT NULL, -- agent ID or "system"
  reason TEXT,
  method TEXT NOT NULL CHECK (method IN ('manual_advance', 'auto_trigger', 'agent_override')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for fast lead history lookups
CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead_id ON stage_transitions(lead_id);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_created_at ON stage_transitions(created_at DESC);

-- Ensure all existing leads have a valid station (migrate NULL to 'new')
UPDATE leads SET station = 'new' WHERE station IS NULL;

-- Add NOT NULL constraint to station field (if not already present)
-- ALTER TABLE leads ALTER COLUMN station SET NOT NULL;
-- Note: Commented out - only run if station field allows NULL in schema
