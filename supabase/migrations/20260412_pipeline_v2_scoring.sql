-- Pipeline V2 Sprint 1: AI-driven scoring gate
-- Adds opportunity_score and classification columns to manifests and leads tables

ALTER TABLE manifests ADD COLUMN IF NOT EXISTS opportunity_score integer;
ALTER TABLE manifests ADD COLUMN IF NOT EXISTS classification text;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS opportunity_score integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS classification text;
