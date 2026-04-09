-- Migration: Missed Call Auto-Text Tracking
-- Adds index for efficient 48-hour window lookups and variant tracking

-- Index for missed call auto-text lookups (supports 48hr window queries)
CREATE INDEX IF NOT EXISTS idx_lead_activities_missed_call_texts
  ON lead_activities (activity_type, created_at DESC)
  WHERE activity_type = 'sms'
    AND metadata->>'trigger' = 'missed_call_auto';

-- Partial index for phone number lookups in metadata
CREATE INDEX IF NOT EXISTS idx_lead_activities_sms_to_phone
  ON lead_activities ((metadata->>'to'))
  WHERE activity_type = 'sms'
    AND metadata->>'trigger' = 'missed_call_auto';

-- Add comment explaining the intelligent messaging system
COMMENT ON INDEX idx_lead_activities_missed_call_texts IS
  'Supports 48-hour window tracking for intelligent missed call auto-reply variants (prevents repetitive messages)';
