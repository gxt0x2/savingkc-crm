-- Bookings table for /call scheduling page
-- Created 2026-03-27 via Supabase SQL Editor
CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  property_address TEXT NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  slot_datetime TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'confirmed',
  source TEXT DEFAULT 'YouTube',
  landing_page TEXT DEFAULT '/call',
  lead_id UUID REFERENCES leads(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
