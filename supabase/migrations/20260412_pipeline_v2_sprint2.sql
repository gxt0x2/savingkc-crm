-- Pipeline V2 Sprint 2 — Async Queue + Property Cache + Conversion Tracking
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/fprrknfyzlthbxewnwmi/sql

-- ============================================================
-- 1. Async Queue Table
-- ============================================================
CREATE TABLE IF NOT EXISTS mojo_call_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer DEFAULT 0,
  last_error text,
  lead_id uuid,
  manifest_id uuid,
  opportunity_score integer,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON mojo_call_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_created ON mojo_call_queue(created_at);

-- ============================================================
-- 2. Property Cache Table
-- ============================================================
CREATE TABLE IF NOT EXISTS property_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  county text NOT NULL,
  parcel_id text,
  address text,
  data jsonb NOT NULL,
  source text,
  fetched_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS idx_cache_key ON property_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON property_cache(expires_at);

-- ============================================================
-- 3. Lead Outcomes Table (conversion tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_outcomes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL,
  opportunity_score_at_creation integer,
  classification_at_creation text,
  actual_outcome text CHECK (actual_outcome IN ('closed', 'dead', 'nurturing', 'pending')),
  revenue numeric,
  days_to_close integer,
  recorded_at timestamptz DEFAULT now()
);
