-- Link a CRM login to the Google mailbox that login connected.
-- user_email stays the Google address (savingkc@gmail.com). crm_user_email is
-- the CRM session (oauth-review@savingkc.com) used to find those tokens.

DO $$
BEGIN
  IF to_regclass('public.user_oauth_tokens') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.user_oauth_tokens
    ADD COLUMN IF NOT EXISTS crm_user_email TEXT;

  CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_crm_user_email
    ON public.user_oauth_tokens (provider, crm_user_email)
    WHERE crm_user_email IS NOT NULL;

  COMMENT ON COLUMN public.user_oauth_tokens.crm_user_email IS
    'CRM login that connected this Google account. user_email remains the Google mailbox.';

  -- OAuth verification sandbox: oauth-review@savingkc.com is connected as savingkc@gmail.com.
  UPDATE public.user_oauth_tokens
  SET crm_user_email = 'oauth-review@savingkc.com'
  WHERE provider = 'google'
    AND lower(user_email) = 'savingkc@gmail.com'
    AND crm_user_email IS NULL;
END $$;
