-- =============================================================================
-- WS-D-CORRECTION-2 — deactivated attributes and attribute values must stop
-- being offered for NEW assignment.
--
-- Defect: catalog.list_attributes (20260724120100_catalog_variant_management_
-- and_lookup.sql) is the only function feeding the product form's attribute
-- pickers, and it predates the activate/deactivate feature entirely: it
-- filtered neither the outer attributes select nor the inner attribute_values
-- aggregate on is_active, and did not return is_active either, so the frontend
-- could not filter client-side. Deactivating an attribute or value therefore
-- had no effect outside the Catalogue Setup screen.
--
-- Owner ruling (Option A): deactivation means "retired -- stop offering it for
-- NEW assignment", NOT "erase it from history". Variants that already use a
-- deactivated value keep it, keep displaying it, and keep their
-- attribute_signature unchanged. This migration therefore only narrows what is
-- OFFERED; it never writes to catalog.variant_attribute_values.
--
-- Deliberately NOT touched, all correct as-is under Option A:
--   * catalog.get_product_detail -- returns a variant's EXISTING attributes by
--     joining catalog.variant_attribute_values with no is_active filter. That
--     is exactly what preserves history; filtering it would make existing
--     variants silently lose attributes on the edit screen.
--   * catalog.list_attributes_v2 / catalog.list_attribute_values -- return ALL
--     rows plus an is_active flag on purpose, because Catalogue Setup must show
--     inactive items in order to reactivate them.
--   * procurement.list_purchase_product_options -- reads
--     variant_attribute_values directly for display; existing assignments must
--     keep showing.
--
-- There is exactly one catalog.list_attributes(text) signature; this is a
-- CREATE OR REPLACE in place, not a new overload (ws-d-skill section 2.1).
-- =============================================================================
CREATE OR REPLACE FUNCTION catalog.list_attributes(p_session_token text)
RETURNS TABLE (attribute_id bigint, name text, attribute_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT a.id, a.name,
            coalesce((
                SELECT jsonb_agg(
                        jsonb_build_object('id', av.id, 'value', av.value, 'is_active', av.is_active)
                        ORDER BY av.value)
                    FROM catalog.attribute_values av
                    WHERE av.attribute_id = a.id
                      AND av.is_active
            ), '[]'::jsonb)
            FROM catalog.attributes a
            WHERE a.is_active
            ORDER BY a.name;
END;
$$;

-- 'is_active' is added alongside the existing 'id'/'value' keys (never
-- renaming or reordering them -- the frontend deserializes by name). Every
-- value this function returns is active by construction, so the flag is always
-- true here; it exists so the product form can render, in the same shape, the
-- already-assigned-but-now-inactive values it merges in from
-- get_product_detail when editing an existing variant, and mark them as
-- retired rather than silently dropping them.

-- =============================================================================
-- Grants -- nothing to PUBLIC, EXECUTE to stockiha_runtime only, matching the
-- original grants in 20260724120100. CREATE OR REPLACE on an identical
-- signature preserves existing grants, but these are re-issued explicitly so
-- the function's authorization does not depend on that detail
-- (ws-d-skill section 4 item 4).
-- =============================================================================
REVOKE ALL ON FUNCTION catalog.list_attributes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_attributes(text) TO stockiha_runtime;
