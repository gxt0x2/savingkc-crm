-- Adds an is_admin flag to agent_profiles and seeds the three current admins
-- (Ernest, Casey, Gert). New admin-gated features (e.g. deleting offers) read
-- this column via /api/settings.

ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE agent_profiles
SET is_admin = TRUE
WHERE LOWER(email) IN (
  'ernest@savingkc.com',
  'casey@savingkc.com',
  'support@savingkc.com'
);
