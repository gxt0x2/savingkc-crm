CREATE TABLE IF NOT EXISTS public.katherine_deceased_load_stage_parts (
  id text NOT NULL,
  seq int NOT NULL,
  chunk text NOT NULL,
  PRIMARY KEY (id, seq)
);
