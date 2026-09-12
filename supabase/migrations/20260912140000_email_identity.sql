-- Email identity is an evidence-backed overlay on canonical CRM people and
-- properties. It never creates, merges, or advances CRM Leads.

DO $$
BEGIN
  IF to_regclass('public.em_workspaces') IS NULL OR to_regclass('public.crm_people') IS NULL OR to_regclass('public.crm_properties') IS NULL OR to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'email identity requires em_workspaces, crm_people, crm_properties and leads';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.em_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'unknown' CHECK (kind IN ('seller','buyer','unknown')),
  lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT,
  canonical_person_id uuid REFERENCES public.crm_people(id) ON DELETE RESTRICT,
  buyer_ref text,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 120),
  identity_state text NOT NULL DEFAULT 'unresolved' CHECK (identity_state IN ('unresolved','confirmed','conflicting','shared')),
  identity_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(identity_evidence) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS em_parties_workspace_lead_unique
  ON public.em_parties (workspace_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS em_parties_workspace_person_unique
  ON public.em_parties (workspace_id, canonical_person_id) WHERE canonical_person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.em_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE RESTRICT,
  raw_address text NOT NULL CHECK (char_length(trim(raw_address)) BETWEEN 3 AND 320),
  normalized_address text NOT NULL CHECK (char_length(trim(normalized_address)) BETWEEN 3 AND 320),
  verification_state text NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified','valid','invalid','risky','unknown')),
  verification_provider text,
  verified_at timestamptz,
  verification_expires_at timestamptz,
  verification_evidence jsonb CHECK (verification_evidence IS NULL OR jsonb_typeof(verification_evidence) = 'object'),
  restriction_revision bigint NOT NULL DEFAULT 1 CHECK (restriction_revision > 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, normalized_address),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS public.em_party_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  party_id uuid NOT NULL,
  address_id uuid NOT NULL,
  relationship text NOT NULL DEFAULT 'candidate' CHECK (relationship IN ('confirmed','candidate','shared')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  confirmed_by uuid,
  confirmed_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, party_id, address_id),
  FOREIGN KEY (workspace_id, party_id) REFERENCES public.em_parties(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, address_id) REFERENCES public.em_addresses(workspace_id, id) ON DELETE RESTRICT,
  CHECK ((relationship = 'confirmed' AND confirmed_at IS NOT NULL) OR relationship <> 'confirmed')
);
CREATE INDEX IF NOT EXISTS em_party_addresses_address_relationship_idx
  ON public.em_party_addresses (workspace_id, address_id, relationship, party_id);

CREATE TABLE IF NOT EXISTS public.em_party_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  party_id uuid NOT NULL,
  canonical_property_id uuid REFERENCES public.crm_properties(id) ON DELETE RESTRICT,
  prospect_id uuid,
  parcel_id text,
  county text,
  address text NOT NULL CHECK (char_length(trim(address)) BETWEEN 1 AND 500),
  relationship text NOT NULL DEFAULT 'unconfirmed' CHECK (relationship IN ('owner','representative','unconfirmed')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, party_id) REFERENCES public.em_parties(workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS em_party_properties_canonical_unique
  ON public.em_party_properties (workspace_id, party_id, canonical_property_id) WHERE canonical_property_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS em_party_properties_address_unique
  ON public.em_party_properties (workspace_id, party_id, lower(address), relationship) WHERE canonical_property_id IS NULL;

CREATE OR REPLACE FUNCTION public.em_identity_touch_updated_at_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.em_identity_touch_updated_at_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS em_parties_touch_updated_at ON public.em_parties;
CREATE TRIGGER em_parties_touch_updated_at BEFORE UPDATE ON public.em_parties FOR EACH ROW EXECUTE FUNCTION public.em_identity_touch_updated_at_v1();
DROP TRIGGER IF EXISTS em_addresses_touch_updated_at ON public.em_addresses;
CREATE TRIGGER em_addresses_touch_updated_at BEFORE UPDATE ON public.em_addresses FOR EACH ROW EXECUTE FUNCTION public.em_identity_touch_updated_at_v1();
DROP TRIGGER IF EXISTS em_party_addresses_touch_updated_at ON public.em_party_addresses;
CREATE TRIGGER em_party_addresses_touch_updated_at BEFORE UPDATE ON public.em_party_addresses FOR EACH ROW EXECUTE FUNCTION public.em_identity_touch_updated_at_v1();
DROP TRIGGER IF EXISTS em_party_properties_touch_updated_at ON public.em_party_properties;
CREATE TRIGGER em_party_properties_touch_updated_at BEFORE UPDATE ON public.em_party_properties FOR EACH ROW EXECUTE FUNCTION public.em_identity_touch_updated_at_v1();

ALTER TABLE public.em_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_party_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_party_properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.em_parties, public.em_addresses, public.em_party_addresses, public.em_party_properties FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.em_parties, public.em_addresses, public.em_party_addresses, public.em_party_properties TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name IN ('em_parties','em_addresses','em_party_addresses','em_party_properties')
      AND grantee IN ('PUBLIC','anon','authenticated')
  ) THEN RAISE EXCEPTION 'email identity tables retain browser-accessible privileges'; END IF;
END $$;
