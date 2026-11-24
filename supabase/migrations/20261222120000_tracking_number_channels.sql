-- G7: a marketing channel for every Twilio number the code does not already
-- label. The code still labels Google Ads lines and cold-call callback lines
-- itself; this table covers the public number, mail numbers, sign numbers,
-- dispositions and staff lines, so no inbound call or text arrives unlabeled.
-- Edited from Settings by admins; read by inbound lead attribution.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.tracking_number_channels (
  number text PRIMARY KEY CHECK (number ~ '^\+1[0-9]{10}$'),
  channel text NOT NULL CHECK (channel IN ('public_number', 'direct_mail', 'signs', 'dispositions', 'staff_direct', 'referral', 'other')),
  campaign text CHECK (campaign IS NULL OR length(campaign) <= 120),
  note text CHECK (note IS NULL OR length(note) <= 300),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tracking_number_channels IS
  'Marketing channel per Twilio number for inbound call and text attribution. Google Ads and cold-call lines are labeled in code.';

ALTER TABLE public.tracking_number_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracking_number_channels FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracking_number_channels TO service_role;

INSERT INTO public.tracking_number_channels (number, channel, campaign, note, updated_by) VALUES
  ('+18164292900', 'public_number', 'website and brand', 'The number on savingkc.com, Google Business Profile and print.', 'migration'),
  ('+18166088858', 'dispositions', NULL, 'Buyer-side line.', 'migration'),
  ('+18166088588', 'staff_direct', 'Ernest', 'Ernest company line.', 'migration'),
  ('+18167277667', 'staff_direct', 'Casey', 'Casey company line.', 'migration'),
  ('+18163754666', 'staff_direct', 'Casey legacy', 'Casey legacy line.', 'migration')
ON CONFLICT (number) DO NOTHING;
