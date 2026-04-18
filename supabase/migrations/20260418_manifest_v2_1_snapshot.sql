-- Phase 7, Phase A — Pre-migration snapshot.
-- Creates manifests_backup_v2_0 as the full rollback insurance before any
-- V2.1 transform touches the live table. Apply this via Supabase SQL editor
-- (idempotent — uses IF NOT EXISTS).
--
-- Per docs/manifest-v2-1-spec/04_MIGRATION_PLAN.md: do not drop this table
-- until V2.1 has been in production for 30 days without incident
-- (earliest drop: May 18, 2026).

CREATE TABLE IF NOT EXISTS manifests_backup_v2_0 AS
  SELECT * FROM manifests;

CREATE INDEX IF NOT EXISTS manifests_backup_v2_0_id_idx
  ON manifests_backup_v2_0 (id);

COMMENT ON TABLE manifests_backup_v2_0 IS
  'Phase 7 pre-migration snapshot taken before V2.1 transform. Do not drop before 2026-05-18 per rollback policy.';
