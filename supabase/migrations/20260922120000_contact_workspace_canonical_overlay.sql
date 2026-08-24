-- Canonical entity authority for the bounded Pipeline page.
--
-- V2 preserves the proven V1 filters, counts, cursors, and transitional
-- Manifest-derived tags, then overlays only the returned page (maximum 50
-- rows) from canonical people, contact methods, properties, and opportunities.
-- This is intentionally additive so V1 remains available for rollback.

CREATE OR REPLACE FUNCTION public.contact_workspace_page_v2(
  target_smart_list TEXT,
  target_scope TEXT,
  target_limit INTEGER,
  page_cursor JSONB,
  target_sort TEXT,
  search_text TEXT,
  owner_filter TEXT,
  stage_filter TEXT,
  minimum_stage_filter TEXT,
  source_filter TEXT,
  tag_filter TEXT,
  activity_filter TEXT,
  attention_filter TEXT,
  outreach_filter TEXT,
  data_gap_filter TEXT,
  reference_time TIMESTAMPTZ
)
RETURNS TABLE (
  items JSONB,
  total_count BIGINT,
  has_more BOOLEAN,
  next_cursor JSONB,
  scope_counts JSONB,
  smart_list_counts JSONB,
  owners TEXT[],
  sources TEXT[],
  tags TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH compatibility_page AS MATERIALIZED (
    SELECT *
    FROM public.contact_workspace_page_v1(
      target_smart_list,
      target_scope,
      target_limit,
      page_cursor,
      target_sort,
      search_text,
      owner_filter,
      stage_filter,
      minimum_stage_filter,
      source_filter,
      tag_filter,
      activity_filter,
      attention_filter,
      outreach_filter,
      data_gap_filter,
      reference_time
    )
  ), canonical_page AS (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN person.id IS NOT NULL AND opportunity.id IS NOT NULL THEN
            expanded.item || jsonb_build_object(
              'full_name', person.display_name,
              'phone', COALESCE(phone.raw_value, expanded.item->>'phone'),
              'email', COALESCE(email.raw_value, expanded.item->>'email'),
              'source', opportunity.source,
              'address', COALESCE(property.address, expanded.item->>'address'),
              'city', COALESCE(property.city, expanded.item->>'city'),
              'station', public.contact_workspace_normalize_stage(opportunity.stage),
              'classification', opportunity.classification,
              'owner', opportunity.owner_name,
              'updated_at', GREATEST(
                person.updated_at,
                opportunity.updated_at,
                property.updated_at,
                phone.updated_at,
                email.updated_at
              ),
              'entity_authority', 'canonical_entities'
            )
          ELSE expanded.item || jsonb_build_object('entity_authority', 'lead_compatibility')
        END
        ORDER BY expanded.ordinality
      ) FILTER (WHERE expanded.item IS NOT NULL),
      '[]'::JSONB
    ) AS items
    FROM compatibility_page AS page
    LEFT JOIN LATERAL jsonb_array_elements(page.items)
      WITH ORDINALITY AS expanded(item, ordinality) ON TRUE
    LEFT JOIN public.crm_lead_entity_links AS entity_link
      ON entity_link.lead_id = (expanded.item->>'id')::UUID
    LEFT JOIN public.crm_people AS person ON person.id = entity_link.person_id
    LEFT JOIN public.crm_properties AS property ON property.id = entity_link.property_id
    LEFT JOIN public.crm_opportunities AS opportunity ON opportunity.id = entity_link.opportunity_id
    LEFT JOIN LATERAL (
      SELECT method.raw_value, method.updated_at
      FROM public.crm_contact_methods AS method
      WHERE method.person_id = entity_link.person_id AND method.method_type = 'phone'
      ORDER BY method.is_primary DESC, method.updated_at DESC, method.id DESC
      LIMIT 1
    ) AS phone ON TRUE
    LEFT JOIN LATERAL (
      SELECT method.raw_value, method.updated_at
      FROM public.crm_contact_methods AS method
      WHERE method.person_id = entity_link.person_id AND method.method_type = 'email'
      ORDER BY method.is_primary DESC, method.updated_at DESC, method.id DESC
      LIMIT 1
    ) AS email ON TRUE
  )
  SELECT
    canonical_page.items,
    page.total_count,
    page.has_more,
    page.next_cursor,
    page.scope_counts,
    page.smart_list_counts,
    page.owners,
    page.sources,
    page.tags
  FROM compatibility_page AS page
  CROSS JOIN canonical_page;
$$;

REVOKE ALL ON FUNCTION public.contact_workspace_page_v2(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_workspace_page_v2(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.contact_workspace_page_v2(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS 'Returns the bounded Pipeline page with canonical entity values overlaid on the V1 compatibility page; response rows remain capped at 50.';
