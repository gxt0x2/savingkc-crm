import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    message: 'Run the SQL migration via Supabase Dashboard or CLI',
    sql: `
CREATE TABLE IF NOT EXISTS manifests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  version INTEGER DEFAULT 2,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_station TEXT DEFAULT 'intake',
  priority TEXT DEFAULT 'hot',
  tier TEXT,
  qualification_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manifests_lead_id_idx ON manifests(lead_id);
CREATE INDEX IF NOT EXISTS manifests_booking_id_idx ON manifests(booking_id);
    `
  })
}
