-- A calendar event with no lead is not a seller appointment.
-- Lead-linked inserts keep the existing seller title defaults.

CREATE OR REPLACE FUNCTION public.mobile_appointment_defaults_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_duration interval;
  provider_fields text[] := ARRAY[
    'provider_event_id', 'provider_sync_status', 'provider_synced_at',
    'provider_sync_error', 'google_event_id', 'updated_at', 'version'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lead_id IS NULL THEN
      NEW.title := coalesce(nullif(btrim(NEW.title), ''), 'Calendar event');
    ELSE
      NEW.title := coalesce(nullif(btrim(NEW.title), ''), CASE NEW.type
        WHEN 'in_person' THEN 'Seller appointment'
        WHEN 'google_meet' THEN 'Seller video appointment'
        ELSE 'Seller phone appointment'
      END);
    END IF;
    NEW.ends_at := coalesce(NEW.ends_at, NEW.scheduled_at + interval '45 minutes');
    NEW.location := coalesce(NEW.location, NEW.address);
    NEW.time_zone := coalesce(nullif(btrim(NEW.time_zone), ''), 'America/Chicago');
    NEW.version := greatest(coalesce(NEW.version, 1), 1);
    RETURN NEW;
  END IF;

  old_duration := OLD.ends_at - OLD.scheduled_at;
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at THEN
    NEW.ends_at := NEW.scheduled_at + greatest(old_duration, interval '15 minutes');
  END IF;
  IF NEW.address IS DISTINCT FROM OLD.address
     AND NEW.location IS NOT DISTINCT FROM OLD.location THEN
    NEW.location := NEW.address;
  END IF;
  IF NEW.version = OLD.version
     AND (to_jsonb(NEW) - provider_fields) IS DISTINCT FROM (to_jsonb(OLD) - provider_fields) THEN
    NEW.version := OLD.version + 1;
  END IF;
  NEW.title := coalesce(nullif(btrim(NEW.title), ''), OLD.title);
  NEW.time_zone := coalesce(nullif(btrim(NEW.time_zone), ''), OLD.time_zone, 'America/Chicago');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_appointment_defaults_v1() FROM PUBLIC, anon, authenticated;
