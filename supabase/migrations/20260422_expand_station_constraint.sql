-- Expand the leads station check constraint to include deal pipeline stages
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_station_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_station_check CHECK (
  station IS NULL OR station::text = ANY(ARRAY[
    'intake','contacted','qualifying','appointment',
    'offer_made','negotiating','under_contract',
    'closing','closed_won','closed_lost','dead','nurture'
  ])
);
