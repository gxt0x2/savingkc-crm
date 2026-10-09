-- hygiene-approved-destructive: drop only the Oct 7 one-shot Katherine deceased
-- load staging tables and helpers after they were processed. Production already
-- applied this exact DROP; the objects are not CRM product tables.
DROP FUNCTION IF EXISTS public.katherine_deceased_process_stage();
DROP FUNCTION IF EXISTS public.katherine_deceased_dialer_load_tmp(jsonb);
DROP TABLE IF EXISTS public.katherine_deceased_member_stage;
DROP TABLE IF EXISTS public.katherine_deceased_load_stage_parts;
DROP TABLE IF EXISTS public.katherine_deceased_load_stage;
