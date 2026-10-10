-- Mobile Create contact writes source='mobile_manual'. Widen the installed
-- leads.source check in place so a later allowlist is preserved, matching the
-- csv_import widening. Also keep one create-contact retry per agent and
-- clientRequestId.
-- hygiene-approved-destructive: only the existing single-column source check
-- is replaced with the same expression plus mobile_manual. No rows are deleted.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $$
DECLARE
  source_constraint_name text;
  source_constraint_expression text;
  source_type text;
  source_column smallint;
  source_constraint_count integer;
  source_constraint_validated boolean;
  source_constraint_noinherit boolean;
BEGIN
  SELECT typ.typname, col.attnum INTO source_type, source_column
  FROM pg_attribute col JOIN pg_type typ ON typ.oid = col.atttypid
  WHERE col.attrelid = 'public.leads'::regclass AND col.attname = 'source';
  IF source_type NOT IN ('text', 'varchar') THEN
    RAISE EXCEPTION 'mobile manual lead requires a text leads.source column';
  END IF;
  SELECT count(*) INTO source_constraint_count FROM pg_constraint
  WHERE conrelid = 'public.leads'::regclass AND contype = 'c'
    AND source_column = ANY (conkey);
  IF source_constraint_count > 1 THEN
    RAISE EXCEPTION 'mobile manual lead source constraint is ambiguous';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass
      AND contype = 'c'
      AND source_column = ANY (conkey)
      AND cardinality(conkey) <> 1
  ) THEN
    RAISE EXCEPTION 'mobile manual lead cannot widen a multi-column source constraint';
  END IF;
  SELECT constraint_row.conname,
    pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
    constraint_row.convalidated, constraint_row.connoinherit
  INTO source_constraint_name, source_constraint_expression,
    source_constraint_validated, source_constraint_noinherit
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.leads'::regclass
    AND constraint_row.contype = 'c'
    AND source_column = ANY (constraint_row.conkey);

  IF source_constraint_expression IS NOT NULL
    AND source_constraint_expression NOT LIKE '%mobile_manual%'
  THEN
    EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I', source_constraint_name);
    EXECUTE format(
      'ALTER TABLE public.leads ADD CONSTRAINT %I CHECK ((%s) OR source::text = %L) %s NOT VALID',
      source_constraint_name,
      source_constraint_expression,
      'mobile_manual',
      CASE WHEN source_constraint_noinherit THEN 'NO INHERIT' ELSE '' END
    );
    IF source_constraint_validated THEN
      EXECUTE format('ALTER TABLE public.leads VALIDATE CONSTRAINT %I', source_constraint_name);
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_mobile_manual_contact
  ON public.lead_activities (
    (metadata ->> 'userId'),
    (metadata ->> 'clientRequestId')
  )
  WHERE activity_type = 'status_change'
    AND metadata ->> 'source' = 'mobile_manual'
    AND COALESCE(metadata ->> 'userId', '') <> ''
    AND COALESCE(metadata ->> 'clientRequestId', '') <> '';
