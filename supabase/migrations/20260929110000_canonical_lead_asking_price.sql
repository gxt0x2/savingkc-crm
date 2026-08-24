-- Asking price is a first-class seller fact used by qualification, AI change
-- proposals, call prep, and disposition. The application already treats it as
-- a lead field; make the database contract explicit before retiring Manifest
-- compatibility reads.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS asking_price numeric
    CHECK (asking_price IS NULL OR asking_price >= 0);

COMMENT ON COLUMN public.leads.asking_price IS
  'Seller-stated asking price. Human-entered or explicitly approved AI proposal; never written autonomously.';
