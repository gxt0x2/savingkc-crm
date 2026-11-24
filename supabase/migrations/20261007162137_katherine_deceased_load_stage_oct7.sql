CREATE TABLE IF NOT EXISTS public.katherine_deceased_load_stage (
  id text PRIMARY KEY,
  payload_b64 text NOT NULL,
  processed_at timestamptz
);
