-- 006: SMS Opt-Out Tracking (TCPA Compliance)
-- Tracks STOP/START opt-out status for all phone numbers

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  is_opted_out boolean NOT NULL DEFAULT true,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  opted_in_at timestamptz,
  reason text, -- e.g. 'STOP', 'UNSUBSCRIBE', etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup for active opt-outs
CREATE INDEX idx_sms_opt_outs_active ON sms_opt_outs (phone) WHERE is_opted_out = true;

-- RLS
ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sms_opt_outs"
  ON sms_opt_outs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated read on sms_opt_outs"
  ON sms_opt_outs FOR SELECT
  USING (auth.role() = 'authenticated');
