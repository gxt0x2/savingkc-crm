-- Apply only after provisioning the dedicated email_workflow_runtime login.
-- Never grant membership in service_role. Table writes serve authenticated Email commands.
GRANT INSERT, UPDATE ON public.leads, public.lead_activities TO email_workflow_runtime;
GRANT INSERT ON public.work_item_events TO email_workflow_runtime;
-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE on task rows.
GRANT UPDATE ON public.work_items TO email_workflow_runtime;
GRANT EXECUTE ON FUNCTION public.create_work_item_v2(text,text,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb) TO email_workflow_runtime;
GRANT EXECUTE ON FUNCTION public.refresh_crm_entity_for_lead(uuid) TO email_workflow_runtime;
