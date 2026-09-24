import { supabaseAdmin } from '@/lib/supabase/admin'
import { getValidAccessTokenResult, hasGoogleOAuthConfig, type StoredToken } from '@/lib/gmail-sync'
import { formatGmailSendError, GMAIL_SEND_SCOPE, hasGoogleScope } from '@/lib/google-oauth-scopes'

export type GmailSendFailureCode =
  | 'google_oauth_not_configured'
  | 'no_token'
  | 'missing_gmail_send'
  | 'token_refresh_failed'
  | 'reauthorization_required'
  | 'gmail_send_failed'
  | 'invalid_recipient'

export type GmailSendResult =
  | { ok: true; id: string; threadId: string | null; from: string }
  | { ok: false; code: GmailSendFailureCode; error: string }

export type StoredGoogleToken = StoredToken & { scope?: string | null }

type GmailSendFetch = typeof fetch

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function encodeRfc822Message(input: {
  from: string
  to: string
  subject: string
  text: string
}): string {
  const subject = /[^\x20-\x7E]/.test(input.subject)
    ? `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`
    : input.subject.replace(/\r|\n/g, ' ')
  const raw = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
  ].join('\r\n')
  return Buffer.from(raw, 'utf8').toString('base64url')
}

export async function sendGmailMessage(input: {
  accessToken: string
  from: string
  to: string
  subject: string
  text: string
  fetchImpl?: GmailSendFetch
}): Promise<GmailSendResult> {
  if (!isValidEmailAddress(input.to)) {
    return { ok: false, code: 'invalid_recipient', error: formatGmailSendError('invalid_recipient') }
  }

  const fetchImpl = input.fetchImpl || fetch
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodeRfc822Message({
        from: input.from,
        to: input.to.trim(),
        subject: input.subject,
        text: input.text,
      }),
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } }
    const message = body.error?.message || `Gmail send failed (${res.status})`
    console.warn(`[gmail-send] users.messages.send failed: ${res.status} ${message}`)
    return { ok: false, code: 'gmail_send_failed', error: message }
  }

  const data = await res.json() as { id?: string; threadId?: string }
  if (!data.id) {
    return { ok: false, code: 'gmail_send_failed', error: formatGmailSendError('gmail_send_failed') }
  }
  return { ok: true, id: data.id, threadId: data.threadId || null, from: input.from }
}

const GOOGLE_TOKEN_COLUMNS = 'id, user_email, access_token, refresh_token, expires_at, last_sync_at, scope'

function tokenFromRow(data: { refresh_token?: string | null } | null, error: { message?: string } | null): StoredGoogleToken | null {
  if (error || !data?.refresh_token) return null
  return data as StoredGoogleToken
}

export async function loadGoogleOAuthToken(userEmail: string): Promise<StoredGoogleToken | null> {
  const email = userEmail.trim().toLowerCase()
  if (!email) return null
  const { data, error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .select(GOOGLE_TOKEN_COLUMNS)
    .eq('user_email', email)
    .eq('provider', 'google')
    .maybeSingle()
  return tokenFromRow(data, error)
}

/**
 * Tokens are keyed by the Google mailbox. Ernest and Casey match on that
 * address. A CRM login whose Google account is different (oauth-review →
 * savingkc@gmail.com) is stored on crm_user_email and resolved here.
 */
export async function loadActorGoogleOAuthToken(actorEmail: string): Promise<StoredGoogleToken | null> {
  const email = actorEmail.trim().toLowerCase()
  if (!email) return null
  const direct = await loadGoogleOAuthToken(email)
  if (direct) return direct
  const { data, error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .select(GOOGLE_TOKEN_COLUMNS)
    .eq('crm_user_email', email)
    .eq('provider', 'google')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return tokenFromRow(data, null)
}

export async function sendConnectedGmail(input: {
  userEmail: string
  to: string
  subject: string
  text: string
  fetchImpl?: GmailSendFetch
  loadToken?: (email: string) => Promise<StoredGoogleToken | null>
  getAccessToken?: typeof getValidAccessTokenResult
}): Promise<GmailSendResult> {
  if (!hasGoogleOAuthConfig()) {
    return { ok: false, code: 'google_oauth_not_configured', error: formatGmailSendError('google_oauth_not_configured') }
  }
  if (!isValidEmailAddress(input.to)) {
    return { ok: false, code: 'invalid_recipient', error: formatGmailSendError('invalid_recipient') }
  }

  const loadToken = input.loadToken || loadActorGoogleOAuthToken
  const token = await loadToken(input.userEmail)
  if (!token) {
    return { ok: false, code: 'no_token', error: formatGmailSendError('no_token') }
  }
  if (!hasGoogleScope(token.scope, GMAIL_SEND_SCOPE)) {
    return { ok: false, code: 'missing_gmail_send', error: formatGmailSendError('missing_gmail_send') }
  }

  const getAccessToken = input.getAccessToken || getValidAccessTokenResult
  const tokenResult = await getAccessToken(token)
  if (!tokenResult.accessToken) {
    const code = tokenResult.error === 'reauthorization_required'
      ? 'reauthorization_required'
      : tokenResult.error === 'google_oauth_not_configured'
        ? 'google_oauth_not_configured'
        : 'token_refresh_failed'
    return { ok: false, code, error: formatGmailSendError(code) }
  }

  return sendGmailMessage({
    accessToken: tokenResult.accessToken,
    from: token.user_email,
    to: input.to,
    subject: input.subject,
    text: input.text,
    fetchImpl: input.fetchImpl,
  })
}

export async function recordOutboundGmail(input: {
  leadId: string
  from: string
  to: string
  subject: string
  text: string
  gmailMessageId: string
  gmailThreadId?: string | null
  syncedFromUser: string
}): Promise<{ persisted: boolean }> {
  const { error } = await supabaseAdmin()
    .from('lead_emails')
    .upsert({
      lead_id: input.leadId,
      gmail_thread_id: input.gmailThreadId || input.gmailMessageId,
      gmail_message_id: input.gmailMessageId,
      subject: input.subject,
      from_address: input.from.toLowerCase(),
      to_addresses: [input.to.toLowerCase()],
      cc_addresses: [],
      body_snippet: input.text.slice(0, 500),
      sent_at: new Date().toISOString(),
      direction: 'outbound',
      synced_from_user: input.syncedFromUser,
    }, { onConflict: 'lead_id,gmail_message_id', ignoreDuplicates: true })

  if (error) {
    console.error('[gmail-send] lead_emails persist failed:', error)
    return { persisted: false }
  }
  return { persisted: true }
}
