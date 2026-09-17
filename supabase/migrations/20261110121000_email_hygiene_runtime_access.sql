-- The hosted email connection uses its existing private backend role.
-- Grant only access to the new module tables; do not change role flags or RLS.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='email_workflow_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.em_person_marketing_rules,public.em_property_marketing_holds,public.em_selected_addresses TO email_workflow_runtime;
 END IF;
END $$;
