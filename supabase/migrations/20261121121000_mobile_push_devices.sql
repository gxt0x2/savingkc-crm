CREATE TABLE IF NOT EXISTS public.mobile_push_devices (
  project_id uuid NOT NULL,
  token text NOT NULL CHECK (char_length(token) <= 220),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, token)
);
CREATE INDEX IF NOT EXISTS mobile_push_devices_user_id_idx ON public.mobile_push_devices(user_id);
ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_push_devices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_push_devices TO service_role;
COMMENT ON TABLE public.mobile_push_devices IS
  'Service-role-only Expo device registry. Registration does not enable push dispatch or native VoIP.';
