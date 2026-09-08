-- Production installations that created ari_briefing_events before the full
-- briefing schema existed can be missing metadata. The Mojo incident monitor
-- uses this field for durable source context, while the application keeps a
-- compatibility fallback until every environment has applied this repair.

ALTER TABLE public.ari_briefing_events
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

UPDATE public.ari_briefing_events
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

ALTER TABLE public.ari_briefing_events
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ari_briefing_events_system_created
  ON public.ari_briefing_events ((metadata->>'system'), created_at DESC)
  WHERE metadata ? 'system';
