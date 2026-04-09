-- Migration: SMS Delivery Tracking and Error Logging
-- Comprehensive logging for all SMS attempts (success and failure)

CREATE TABLE IF NOT EXISTS sms_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Message details
  to_phone TEXT NOT NULL,
  from_phone TEXT NOT NULL,
  message_body TEXT NOT NULL,

  -- Delivery status
  success BOOLEAN NOT NULL,
  twilio_sid TEXT,
  twilio_status TEXT,

  -- Error details (if failed)
  error_message TEXT,
  twilio_error_code INTEGER,
  http_status INTEGER,

  -- Indexes for monitoring queries
  CONSTRAINT sms_delivery_log_created_at_check CHECK (created_at <= now())
);

-- Index for monitoring recent deliveries
CREATE INDEX idx_sms_delivery_log_recent
  ON sms_delivery_log (created_at DESC);

-- Index for finding failed deliveries
CREATE INDEX idx_sms_delivery_log_failures
  ON sms_delivery_log (success, created_at DESC)
  WHERE success = false;

-- Index for tracking deliveries to specific numbers
CREATE INDEX idx_sms_delivery_log_to_phone
  ON sms_delivery_log (to_phone, created_at DESC);

-- Index for Twilio SID lookups
CREATE INDEX idx_sms_delivery_log_twilio_sid
  ON sms_delivery_log (twilio_sid)
  WHERE twilio_sid IS NOT NULL;

-- Add helpful comments
COMMENT ON TABLE sms_delivery_log IS
  'Comprehensive SMS delivery tracking - logs all attempts (success and failure) for monitoring and debugging';

COMMENT ON COLUMN sms_delivery_log.success IS
  'True if Twilio accepted the message, false if sending failed';

COMMENT ON COLUMN sms_delivery_log.twilio_status IS
  'Twilio message status: queued, sent, delivered, failed, undelivered';

COMMENT ON COLUMN sms_delivery_log.twilio_error_code IS
  'Twilio error code (e.g., 21211 = invalid phone number, 21608 = unverified number)';
