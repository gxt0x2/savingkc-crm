-- SmarterContact clone — foundation schema
-- Cold mass-texting layer. Cold uploaded contacts live in sc_contacts (kept
-- separate from the heavyweight `leads` pipeline; convert-to-lead on positive
-- reply). Reuses existing sms_opt_outs (suppression), sms_delivery_log, and
-- sms_templates. All tables prefixed `sc_`.
--
-- Convention (matches existing migrations): RLS on, service_role full access,
-- authenticated read. App mutates server-side with the service role key.

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sc_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    text,
  last_name     text,
  phone         text NOT NULL,                 -- E.164
  email         text,
  address       text,
  city          text,
  state         text,
  zip           text,
  tags          text[] NOT NULL DEFAULT '{}',
  custom_fields jsonb NOT NULL DEFAULT '{}',
  lead_id       uuid,                           -- link once converted
  status        text NOT NULL DEFAULT 'active'  -- active | deleted
                CHECK (status IN ('active','deleted')),
  source        text,                           -- upload filename / 'manual'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sc_contacts_phone ON sc_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_sc_contacts_status ON sc_contacts (status);
CREATE INDEX IF NOT EXISTS idx_sc_contacts_tags ON sc_contacts USING gin (tags);
DROP TRIGGER IF EXISTS trg_sc_contacts_touch ON sc_contacts;
CREATE TRIGGER trg_sc_contacts_touch BEFORE UPDATE ON sc_contacts
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Groups (uploaded lists) + membership
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  source        text NOT NULL DEFAULT 'manual'  -- upload | manual | filter
                CHECK (source IN ('upload','manual','filter')),
  contact_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sc_groups_touch ON sc_groups;
CREATE TRIGGER trg_sc_groups_touch BEFORE UPDATE ON sc_groups
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

CREATE TABLE IF NOT EXISTS sc_group_members (
  group_id   uuid NOT NULL REFERENCES sc_groups(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES sc_contacts(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_sc_group_members_contact ON sc_group_members (contact_id);

-- ---------------------------------------------------------------------------
-- Sending numbers (deliverability pool)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_sending_numbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,                  -- E.164
  label         text,
  type          text NOT NULL DEFAULT 'local'   -- local | toll_free
                CHECK (type IN ('local','toll_free')),
  status        text NOT NULL DEFAULT 'active'  -- active | paused | warming | released
                CHECK (status IN ('active','paused','warming','released')),
  provider      text NOT NULL DEFAULT 'twilio',
  twilio_sid    text,
  sms_sent      integer NOT NULL DEFAULT 0,
  sms_delivered integer NOT NULL DEFAULT 0,
  sms_blocked   integer NOT NULL DEFAULT 0,     -- carrier blocks / undelivered
  active_chats  integer NOT NULL DEFAULT 0,
  daily_sent    integer NOT NULL DEFAULT 0,
  daily_cap     integer NOT NULL DEFAULT 200,
  daily_reset_on date,
  last_used_at  timestamptz,
  added_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sc_sending_numbers_phone ON sc_sending_numbers (phone);
CREATE INDEX IF NOT EXISTS idx_sc_sending_numbers_status ON sc_sending_numbers (status);
DROP TRIGGER IF EXISTS trg_sc_sending_numbers_touch ON sc_sending_numbers;
CREATE TRIGGER trg_sc_sending_numbers_touch BEFORE UPDATE ON sc_sending_numbers
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Conversations (thread state for the unified inbox) + messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid REFERENCES sc_contacts(id) ON DELETE SET NULL,
  contact_phone  text NOT NULL,                 -- E.164, the far end
  sending_number text,                          -- our number last used
  last_message_at timestamptz,
  last_direction text,                          -- inbound | outbound
  last_body      text,
  unread_count   integer NOT NULL DEFAULT 0,
  is_read        boolean NOT NULL DEFAULT true,
  awaiting_reply boolean NOT NULL DEFAULT false,-- we sent, they haven't replied
  has_replied    boolean NOT NULL DEFAULT false,
  opted_out      boolean NOT NULL DEFAULT false,
  missed_call    boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'open'   -- open | deleted
                 CHECK (status IN ('open','deleted')),
  assigned_to    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sc_conversations_phone ON sc_conversations (contact_phone);
CREATE INDEX IF NOT EXISTS idx_sc_conversations_inbox
  ON sc_conversations (status, last_message_at DESC);
DROP TRIGGER IF EXISTS trg_sc_conversations_touch ON sc_conversations;
CREATE TRIGGER trg_sc_conversations_touch BEFORE UPDATE ON sc_conversations
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

CREATE TABLE IF NOT EXISTS sc_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES sc_conversations(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES sc_contacts(id) ON DELETE SET NULL,
  contact_phone   text NOT NULL,
  sending_number  text,
  direction       text NOT NULL                 -- inbound | outbound
                  CHECK (direction IN ('inbound','outbound')),
  body            text NOT NULL,
  segments        integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'sent'  -- queued|sent|delivered|failed|undelivered|received
                  CHECK (status IN ('queued','sent','delivered','failed','undelivered','received')),
  twilio_sid      text,
  error_code      integer,
  campaign_id     uuid,
  workflow_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sc_messages_conversation
  ON sc_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sc_messages_sid ON sc_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sc_messages_campaign ON sc_messages (campaign_id) WHERE campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Quick replies + saved filters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_quick_replies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  body       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sc_quick_replies_touch ON sc_quick_replies;
CREATE TRIGGER trg_sc_quick_replies_touch BEFORE UPDATE ON sc_quick_replies
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

CREATE TABLE IF NOT EXISTS sc_saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  filter     jsonb NOT NULL DEFAULT '{}',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Campaigns (standard + keyword) + recipients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  type             text NOT NULL DEFAULT 'standard'  -- standard | keyword
                   CHECK (type IN ('standard','keyword')),
  status           text NOT NULL DEFAULT 'draft'     -- draft|scheduled|active|paused|completed|deleted
                   CHECK (status IN ('draft','scheduled','active','paused','completed','deleted')),
  group_id         uuid REFERENCES sc_groups(id) ON DELETE SET NULL,
  message_body     text,                             -- supports {merge} + spintax {a|b}
  template_id      uuid,
  from_strategy    text NOT NULL DEFAULT 'pool'      -- pool | single
                   CHECK (from_strategy IN ('pool','single')),
  sending_number_ids uuid[] NOT NULL DEFAULT '{}',
  throttle_per_hour integer NOT NULL DEFAULT 500,
  send_window_start time,
  send_window_end   time,
  timezone         text NOT NULL DEFAULT 'America/Chicago',
  -- keyword-campaign fields
  keyword          text,
  keyword_number   text,
  auto_reply_body  text,
  -- schedule + counters
  scheduled_at     timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count       integer NOT NULL DEFAULT 0,
  delivered_count  integer NOT NULL DEFAULT 0,
  failed_count     integer NOT NULL DEFAULT 0,
  reply_count      integer NOT NULL DEFAULT 0,
  optout_count     integer NOT NULL DEFAULT 0,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sc_campaigns_status ON sc_campaigns (type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_campaigns_keyword ON sc_campaigns (keyword) WHERE type = 'keyword';
DROP TRIGGER IF EXISTS trg_sc_campaigns_touch ON sc_campaigns;
CREATE TRIGGER trg_sc_campaigns_touch BEFORE UPDATE ON sc_campaigns
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

CREATE TABLE IF NOT EXISTS sc_campaign_recipients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL REFERENCES sc_campaigns(id) ON DELETE CASCADE,
  contact_id     uuid REFERENCES sc_contacts(id) ON DELETE SET NULL,
  phone          text NOT NULL,
  rendered_body  text,
  sending_number text,
  status         text NOT NULL DEFAULT 'pending'  -- pending|sent|delivered|failed|skipped|replied
                 CHECK (status IN ('pending','sent','delivered','failed','skipped','replied')),
  twilio_sid     text,
  error          text,
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sc_campaign_recipients_pending
  ON sc_campaign_recipients (campaign_id, status);

-- ---------------------------------------------------------------------------
-- Workflows (drip automation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_workflows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'draft'   -- active | paused | draft
                 CHECK (status IN ('active','paused','draft')),
  trigger        text NOT NULL DEFAULT 'manual'  -- manual|on_reply|on_group_add|on_keyword
                 CHECK (trigger IN ('manual','on_reply','on_group_add','on_keyword')),
  from_strategy  text NOT NULL DEFAULT 'pool'
                 CHECK (from_strategy IN ('pool','single')),
  sending_number_ids uuid[] NOT NULL DEFAULT '{}',
  enrolled_count integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sc_workflows_touch ON sc_workflows;
CREATE TRIGGER trg_sc_workflows_touch BEFORE UPDATE ON sc_workflows
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

CREATE TABLE IF NOT EXISTS sc_workflow_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES sc_workflows(id) ON DELETE CASCADE,
  step_order  integer NOT NULL,
  delay_days  integer NOT NULL DEFAULT 0,
  delay_hours integer NOT NULL DEFAULT 0,
  channel     text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  body        text NOT NULL,
  template_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sc_workflow_steps_wf ON sc_workflow_steps (workflow_id, step_order);

CREATE TABLE IF NOT EXISTS sc_workflow_enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid NOT NULL REFERENCES sc_workflows(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES sc_contacts(id) ON DELETE CASCADE,
  phone        text NOT NULL,
  status       text NOT NULL DEFAULT 'active'   -- active | completed | stopped
               CHECK (status IN ('active','completed','stopped')),
  current_step integer NOT NULL DEFAULT 0,
  next_run_at  timestamptz,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sc_workflow_enroll_due
  ON sc_workflow_enrollments (status, next_run_at)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sc_workflow_enroll_unique
  ON sc_workflow_enrollments (workflow_id, phone);

-- ---------------------------------------------------------------------------
-- Dialer call scripts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_call_scripts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sc_call_scripts_touch ON sc_call_scripts;
CREATE TRIGGER trg_sc_call_scripts_touch BEFORE UPDATE ON sc_call_scripts
  FOR EACH ROW EXECUTE FUNCTION sc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Skiptrace jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sc_skiptrace_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'  -- pending|processing|completed|failed
               CHECK (status IN ('pending','processing','completed','failed')),
  total_rows   integer NOT NULL DEFAULT 0,
  matched_rows integer NOT NULL DEFAULT 0,
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Atomic counter helpers (avoid read-modify-write races in the send worker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sc_number_record_send(p_number_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE sc_sending_numbers
  SET sms_sent    = sms_sent + 1,
      daily_sent  = CASE WHEN daily_reset_on = current_date THEN daily_sent + 1 ELSE 1 END,
      daily_reset_on = current_date,
      last_used_at = now()
  WHERE id = p_number_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sc_number_record_send_by_phone(p_phone text)
RETURNS void AS $$
BEGIN
  UPDATE sc_sending_numbers
  SET sms_sent    = sms_sent + 1,
      daily_sent  = CASE WHEN daily_reset_on = current_date THEN daily_sent + 1 ELSE 1 END,
      daily_reset_on = current_date,
      last_used_at = now()
  WHERE phone = p_phone;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sc_number_record_result(p_from_phone text, p_delivered boolean)
RETURNS void AS $$
DECLARE r sc_sending_numbers%ROWTYPE;
BEGIN
  SELECT * INTO r FROM sc_sending_numbers WHERE phone = p_from_phone;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE sc_sending_numbers
  SET sms_delivered = sms_delivered + CASE WHEN p_delivered THEN 1 ELSE 0 END,
      sms_blocked   = sms_blocked   + CASE WHEN p_delivered THEN 0 ELSE 1 END,
      status = CASE
        WHEN status = 'active'
         AND sms_sent >= 50
         AND (sms_blocked + CASE WHEN p_delivered THEN 0 ELSE 1 END)::numeric / NULLIF(sms_sent,0) >= 0.10
        THEN 'paused' ELSE status END
  WHERE id = r.id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- RLS: service_role full, authenticated read (matches existing convention)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sc_contacts','sc_groups','sc_group_members','sc_sending_numbers',
    'sc_conversations','sc_messages','sc_quick_replies','sc_saved_filters',
    'sc_campaigns','sc_campaign_recipients','sc_workflows','sc_workflow_steps',
    'sc_workflow_enrollments','sc_call_scripts','sc_skiptrace_jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$DROP POLICY IF EXISTS "service role full %1$s" ON %1$I$p$, t);
    EXECUTE format($p$CREATE POLICY "service role full %1$s" ON %1$I FOR ALL USING (auth.role() = 'service_role')$p$, t);
    EXECUTE format($p$DROP POLICY IF EXISTS "authenticated read %1$s" ON %1$I$p$, t);
    EXECUTE format($p$CREATE POLICY "authenticated read %1$s" ON %1$I FOR SELECT USING (auth.role() = 'authenticated')$p$, t);
  END LOOP;
END $$;
