-- MNT-01: Mail Tracking Model
-- Night 4 Phase 2: Handwritten Note Tracker

CREATE TABLE IF NOT EXISTS mail_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Mail piece details
  type VARCHAR(50) NOT NULL CHECK (type IN ('handwritten_note', 'postcard', 'letter', 'package')),
  status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',
    'written',
    'mailed',
    'in_transit',
    'delivered',
    'follow_up_scheduled',
    'follow_up_completed',
    'returned'
  )),

  -- Dates
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  written_date DATE,
  mailed_date DATE,
  estimated_delivery_date DATE, -- mailed_date + 5 business days
  actual_delivery_date DATE, -- from USPS tracking if available
  follow_up_date DATE, -- estimated_delivery + 1-2 days
  follow_up_completed_date DATE,

  -- Follow-up task linkage
  follow_up_task_id UUID, -- references lead_activities.id where type='task'

  -- Content/notes
  notes TEXT,
  tracking_number VARCHAR(100), -- USPS tracking if available

  -- Metadata
  created_by VARCHAR(100), -- agent name
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mail_pieces_lead_id ON mail_pieces(lead_id);
CREATE INDEX IF NOT EXISTS idx_mail_pieces_status ON mail_pieces(status);
CREATE INDEX IF NOT EXISTS idx_mail_pieces_follow_up_date ON mail_pieces(follow_up_date) WHERE follow_up_completed_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_pieces_created_at ON mail_pieces(created_at DESC);

-- Function to calculate business days (exclude weekends)
CREATE OR REPLACE FUNCTION add_business_days(start_date DATE, days INTEGER)
RETURNS DATE AS $$
DECLARE
  result_date DATE := start_date;
  days_added INTEGER := 0;
BEGIN
  WHILE days_added < days LOOP
    result_date := result_date + 1;
    -- Skip weekends (6 = Saturday, 0 = Sunday in PostgreSQL)
    IF EXTRACT(DOW FROM result_date) NOT IN (0, 6) THEN
      days_added := days_added + 1;
    END IF;
  END LOOP;
  RETURN result_date;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate estimated_delivery_date when mailed_date is set
CREATE OR REPLACE FUNCTION set_estimated_delivery_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.mailed_date IS NOT NULL AND (OLD.mailed_date IS NULL OR OLD.mailed_date != NEW.mailed_date) THEN
    NEW.estimated_delivery_date := add_business_days(NEW.mailed_date, 5);
    -- Auto-set follow_up_date to 1-2 days after estimated delivery (using 2 days)
    NEW.follow_up_date := add_business_days(NEW.estimated_delivery_date, 2);
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_estimated_delivery_date
  BEFORE INSERT OR UPDATE ON mail_pieces
  FOR EACH ROW
  EXECUTE FUNCTION set_estimated_delivery_date();

COMMENT ON TABLE mail_pieces IS 'Tracks handwritten notes, postcards, and direct mail sent to leads';
COMMENT ON COLUMN mail_pieces.type IS 'handwritten_note, postcard, letter, package';
COMMENT ON COLUMN mail_pieces.status IS 'queued → written → mailed → in_transit → delivered → follow_up_scheduled → follow_up_completed';
COMMENT ON COLUMN mail_pieces.estimated_delivery_date IS 'Auto-calculated: mailed_date + 5 business days';
COMMENT ON COLUMN mail_pieces.follow_up_date IS 'Auto-calculated: estimated_delivery_date + 2 business days';
