-- Optional map coordinates for mortgage foreclosure prospects.
-- Rows without a geocode stay on the sale queue and simply have no pin.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.mortgage_foreclosure_prospects
  ADD COLUMN IF NOT EXISTS latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9, 6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_coordinates_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_coordinates_check
      CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.mortgage_foreclosure_prospects.latitude IS
  'Optional WGS84 latitude for the sale map. Null when the row has not been geocoded.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.longitude IS
  'Optional WGS84 longitude for the sale map. Null when the row has not been geocoded.';
