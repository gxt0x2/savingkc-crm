-- 007: SMS Template Library
-- Stores reusable SMS templates with merge fields

CREATE TABLE IF NOT EXISTS sms_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  category text NOT NULL, -- 'intro', 'missed_call', 'ghost_protocol', 'follow_up', 'nurture'
  body text NOT NULL,
  merge_fields text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_templates_category ON sms_templates (category) WHERE is_active = true;

-- RLS
ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sms_templates"
  ON sms_templates FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated read on sms_templates"
  ON sms_templates FOR SELECT
  USING (auth.role() = 'authenticated');

-- Seed templates
INSERT INTO sms_templates (name, category, body, merge_fields) VALUES
  ('intro', 'intro',
   'Hi {firstName}, this is Ernest with Saving KC Homebuyers. We help homeowners sell their property quickly and hassle-free. Would you be open to a quick chat about your property at {propertyAddress}?',
   ARRAY['firstName', 'propertyAddress']),

  ('missed_call_known', 'missed_call',
   'Hey {firstName}, this is Ernest with Saving KC — I just missed your call. I''m available now if you''d like to try again, or I can call you back at a better time.',
   ARRAY['firstName']),

  ('missed_call_unknown', 'missed_call',
   'Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we''ll call you right back.',
   ARRAY[]::text[]),

  ('ghost_protocol_day1', 'ghost_protocol',
   'Hey {firstName}, just checking in — still interested in discussing your property at {propertyAddress}? No pressure, just want to make sure I follow up. - Ernest, Saving KC',
   ARRAY['firstName', 'propertyAddress']),

  ('ghost_protocol_day10', 'ghost_protocol',
   'Hi {firstName}, I know life gets busy. If selling {propertyAddress} is still on your mind, I''m here whenever you''re ready. We can make it simple. - Ernest',
   ARRAY['firstName', 'propertyAddress']),

  ('ghost_protocol_day21', 'ghost_protocol',
   '{firstName}, just wanted you to know the door is always open. If your situation changes or you want to explore your options for {propertyAddress}, give me a call anytime. - Ernest, Saving KC',
   ARRAY['firstName', 'propertyAddress']),

  ('follow_up_general', 'follow_up',
   'Hi {firstName}, following up on our conversation about {propertyAddress}. Do you have any questions I can help with? - Ernest, Saving KC',
   ARRAY['firstName', 'propertyAddress']),

  ('nurture_30d', 'nurture',
   'Hi {firstName}, it''s Ernest from Saving KC. Just checking in — has anything changed with your property at {propertyAddress}? Happy to chat if you have questions.',
   ARRAY['firstName', 'propertyAddress']),

  ('nurture_90d', 'nurture',
   'Hey {firstName}, hope you''re doing well. If you ever want to revisit selling {propertyAddress}, we''re still interested. No pressure — just keeping the door open. - Ernest',
   ARRAY['firstName', 'propertyAddress']),

  ('yes_reply_confirmation', 'auto',
   'Perfect! We''ll call you right back in just a few minutes.',
   ARRAY[]::text[])
ON CONFLICT (name) DO NOTHING;
