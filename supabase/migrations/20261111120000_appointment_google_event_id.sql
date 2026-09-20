-- Store the Google Calendar event id so CRM appointment updates patch
-- the existing primary-calendar event instead of creating duplicates.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_google_event_id
  ON public.appointments (google_event_id)
  WHERE google_event_id IS NOT NULL;

COMMENT ON COLUMN public.appointments.google_event_id IS
  'Google Calendar event id on the owner primary calendar. Used to update without duplicating.';
