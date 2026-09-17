-- Additive only. Never merge heirs by property or clear an existing stop.
CREATE TABLE IF NOT EXISTS public.em_person_marketing_rules (
 workspace_id uuid NOT NULL, party_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('stopped','deceased_reported','deceased_confirmed')),
 reason text NOT NULL, evidence text NOT NULL, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,party_id),
 FOREIGN KEY(workspace_id,party_id) REFERENCES public.em_parties(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.em_property_marketing_holds (
 workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
 canonical_property_id uuid NOT NULL REFERENCES public.crm_properties(id),
 reason text NOT NULL, evidence text NOT NULL, owner_id uuid NOT NULL,
 source_party_id uuid, active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,canonical_property_id),
 FOREIGN KEY(workspace_id,source_party_id) REFERENCES public.em_parties(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.em_selected_addresses (
 workspace_id uuid NOT NULL, party_id uuid NOT NULL, address_id uuid NOT NULL,
 slot smallint NOT NULL CHECK(slot IN (1,2)), selected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,party_id,slot), UNIQUE(workspace_id,party_id,address_id),
 FOREIGN KEY(workspace_id,party_id,address_id) REFERENCES public.em_party_addresses(workspace_id,party_id,address_id)
);
-- Preserve existing active identity/address choices; never promote a backup on silence or bounce.
INSERT INTO public.em_selected_addresses(workspace_id,party_id,address_id,slot)
SELECT workspace_id,party_id,address_id,n::smallint FROM (
 SELECT pa.workspace_id,pa.party_id,pa.address_id,row_number() OVER(PARTITION BY pa.workspace_id,pa.party_id ORDER BY
 EXISTS(SELECT 1 FROM public.em_threads t WHERE t.workspace_id=pa.workspace_id AND t.party_id=pa.party_id AND t.address_id=pa.address_id) DESC,
 pa.confirmed_at,pa.id) n
 FROM public.em_party_addresses pa WHERE pa.relationship='confirmed'
) ranked WHERE n<=2 ON CONFLICT DO NOTHING;
-- Persist personal opt-outs so an address linked later cannot bypass the stop.
INSERT INTO public.em_person_marketing_rules(workspace_id,party_id,status,reason,evidence)
SELECT DISTINCT ON(pa.workspace_id,pa.party_id) pa.workspace_id,pa.party_id,'stopped',s.reason,'Existing confirmed personal stop'
FROM public.em_suppressions s JOIN public.em_party_addresses pa ON pa.workspace_id=s.workspace_id AND pa.address_id=s.address_id AND pa.relationship='confirmed'
WHERE s.reason IN ('unsubscribe','complaint','manual') AND
 (SELECT count(*) FROM public.em_party_addresses p WHERE p.workspace_id=pa.workspace_id AND p.address_id=pa.address_id AND p.relationship IN ('confirmed','shared'))=1
ORDER BY pa.workspace_id,pa.party_id,s.effective_at DESC ON CONFLICT DO NOTHING;
-- Heir is a relationship supported by evidence, never inferred from a shared address.
ALTER TABLE public.em_party_properties DROP CONSTRAINT IF EXISTS em_party_properties_relationship_check;
ALTER TABLE public.em_party_properties ADD CONSTRAINT em_party_properties_relationship_check CHECK(relationship IN ('owner','representative','heir','unconfirmed'));
ALTER TABLE public.em_person_marketing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_property_marketing_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_selected_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_person_marketing_rules,public.em_property_marketing_holds,public.em_selected_addresses FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.em_person_marketing_rules,public.em_property_marketing_holds,public.em_selected_addresses TO service_role;
