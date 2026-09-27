import { supabaseAdmin } from '@/lib/supabase/admin'
import { getValidAccessTokenResult, type StoredToken } from '@/lib/gmail-sync'
import { GMAIL_READONLY_SCOPE, hasGoogleScope } from '@/lib/google-oauth-scopes'
import { isStaffOrSandboxMailbox, readGmailPubSubReadiness } from '@/lib/gmail-pubsub'

export const GMAIL_WATCH_RENEW_BEFORE_MS = 6 * 24 * 60 * 60 * 1000

export type GmailWatchToken = StoredToken & {
  scope?: string | null
  crm_user_email?: string | null
  gmail_history_id?: string | null
  gmail_watch_expiration?: string | null
  gmail_watch_topic?: string | null
}

export function gmailWatchNeedsRenewal(
  expirationIso: string | null | undefined,
  nowMs = Date.now(),
  renewBeforeMs = GMAIL_WATCH_RENEW_BEFORE_MS,
): boolean {
  if (!expirationIso) return true
  const expires = Date.parse(expirationIso)
  if (!Number.isFinite(expires)) return true
  return expires - nowMs <= renewBeforeMs
}

export function historyIdAfterWatch(existing: string | null | undefined, watchHistoryId: string): string {
  return existing?.trim() ? existing.trim() : watchHistoryId
}

export function historyIdAfterIngest(existing: string | null | undefined, ingestedThrough: string): string {
  const current = existing?.trim() || ''
  if (!current) return ingestedThrough
  try {
    return BigInt(ingestedThrough) > BigInt(current) ? ingestedThrough : current
  } catch {
    return ingestedThrough
  }
}

type WatchStartResult =
  | { ok: true; historyId: string; expirationMs: number }
  | { ok: false; code: string }

export async function startGmailWatch(input: {
  accessToken: string
  topicName: string
  fetchImpl?: typeof fetch
}): Promise<WatchStartResult> {
  const fetchImpl = input.fetchImpl || fetch
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topicName: input.topicName,
      labelIds: ['INBOX'],
      labelFilterAction: 'include',
    }),
  })
  if (!res.ok) return { ok: false, code: `gmail_watch_${res.status}` }
  const body = await res.json() as { historyId?: unknown; expiration?: unknown }
  const historyId = String(body.historyId ?? '').trim()
  const expirationMs = Number(body.expiration)
  if (!/^\d+$/.test(historyId) || !Number.isFinite(expirationMs)) {
    return { ok: false, code: 'gmail_watch_incomplete' }
  }
  return { ok: true, historyId, expirationMs }
}

export async function stopGmailWatch(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; code: string }> {
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.ok || res.status === 404) return { ok: true, code: 'watch_stopped' }
  return { ok: false, code: `gmail_stop_${res.status}` }
}

function watchStateMissing(message: string | undefined): boolean {
  return /gmail_history_id|gmail_watch_expiration|gmail_watch_topic/i.test(message || '')
}

export async function saveGmailWatchState(input: {
  userEmail: string
  historyId: string
  expiration: string
  topic: string
}): Promise<{ ok: boolean; code?: string }> {
  const { error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .update({
      gmail_history_id: input.historyId,
      gmail_watch_expiration: input.expiration,
      gmail_watch_topic: input.topic,
      updated_at: new Date().toISOString(),
    })
    .eq('user_email', input.userEmail.trim().toLowerCase())
    .eq('provider', 'google')
  if (!error) return { ok: true }
  if (watchStateMissing(error.message)) return { ok: false, code: 'watch_state_unavailable' }
  console.warn(`[gmail-watch] state save failed: ${error.code || 'unknown'}`)
  return { ok: false, code: 'watch_state_failed' }
}

export async function saveGmailHistoryCursor(userEmail: string, historyId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .update({ gmail_history_id: historyId })
    .eq('user_email', userEmail.trim().toLowerCase())
    .eq('provider', 'google')
  if (error && !watchStateMissing(error.message)) {
    console.warn(`[gmail-watch] history cursor save failed: ${error.code || 'unknown'}`)
  }
}

export type WatchEnsureResult = {
  ok: boolean
  code: string
  historyId?: string
  expiration?: string
}

export async function ensureGmailWatch(input: {
  userEmail: string
  accessToken?: string | null
  crmEmail?: string | null
  scope?: string | null
  historyId?: string | null
  expiration?: string | null
  force?: boolean
  nowMs?: number
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  save?: (state: { historyId: string; expiration: string; topic: string }) => Promise<{ ok: boolean; code?: string }>
}): Promise<WatchEnsureResult> {
  const readiness = readGmailPubSubReadiness(input.env)
  if (!readiness.ok) return { ok: false, code: 'pubsub_not_configured' }
  if (!isStaffOrSandboxMailbox({
    googleEmail: input.userEmail,
    crmEmail: input.crmEmail,
    extraAllowlist: readiness.allowlist,
  })) {
    return { ok: false, code: 'mailbox_not_eligible' }
  }
  if (input.scope && !hasGoogleScope(input.scope, GMAIL_READONLY_SCOPE)) {
    return { ok: false, code: 'missing_gmail_readonly' }
  }
  if (!input.force && !gmailWatchNeedsRenewal(input.expiration, input.nowMs)) {
    return { ok: true, code: 'watch_current' }
  }
  if (!input.accessToken) return { ok: false, code: 'no_access_token' }

  const started = await startGmailWatch({
    accessToken: input.accessToken,
    topicName: readiness.topic,
    fetchImpl: input.fetchImpl,
  })
  if (!started.ok) return { ok: false, code: started.code }

  const historyId = historyIdAfterWatch(input.historyId, started.historyId)
  const expiration = new Date(started.expirationMs).toISOString()
  const save = input.save || ((state) => saveGmailWatchState({ userEmail: input.userEmail, ...state }))
  const saved = await save({ historyId, expiration, topic: readiness.topic })
  if (!saved.ok) return { ok: false, code: saved.code || 'watch_state_unavailable', historyId, expiration }
  return { ok: true, code: 'watch_started', historyId, expiration }
}

async function loadGoogleToken(userEmail: string): Promise<GmailWatchToken | null> {
  const { data, error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .select('*')
    .eq('user_email', userEmail.trim().toLowerCase())
    .eq('provider', 'google')
    .maybeSingle()
  if (error || !data?.refresh_token) return null
  return data as GmailWatchToken
}

export async function renewGmailWatchForMailbox(userEmail: string, force = false): Promise<{ code: string }> {
  const readiness = readGmailPubSubReadiness()
  if (!readiness.ok) return { code: 'pubsub_not_configured' }
  const row = await loadGoogleToken(userEmail)
  if (!row) return { code: 'no_token' }
  const access = await getValidAccessTokenResult(row)
  if (!access.accessToken) return { code: access.error || 'no_access_token' }
  const watch = await ensureGmailWatch({
    userEmail: row.user_email,
    crmEmail: row.crm_user_email,
    scope: row.scope,
    historyId: row.gmail_history_id,
    expiration: row.gmail_watch_expiration,
    accessToken: access.accessToken,
    force,
  })
  return { code: watch.code }
}

export async function stopConnectedGmailWatch(token: StoredToken): Promise<{ code: string }> {
  const access = await getValidAccessTokenResult(token)
  if (!access.accessToken) return { code: access.error || 'no_access_token' }
  try {
    const stopped = await stopGmailWatch(access.accessToken)
    return { code: stopped.code }
  } catch {
    return { code: 'gmail_stop_failed' }
  }
}

export async function renewDueGmailWatches(): Promise<{
  code: string
  results: Array<{ user_email: string; code: string }>
}> {
  const readiness = readGmailPubSubReadiness()
  if (!readiness.ok) return { code: 'pubsub_not_configured', results: [] }

  const db = supabaseAdmin()
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  await db
    .from('gmail_push_receipts')
    .delete()
    .eq('status', 'processed')
    .lt('received_at', cutoff)

  const { data, error } = await db
    .from('user_oauth_tokens')
    .select('*')
    .eq('provider', 'google')
  if (error) return { code: 'token_lookup_failed', results: [] }

  const results: Array<{ user_email: string; code: string }> = []
  for (const row of (data || []) as GmailWatchToken[]) {
    if (!row.refresh_token) {
      results.push({ user_email: row.user_email, code: 'no_token' })
      continue
    }
    const access = await getValidAccessTokenResult(row)
    if (!access.accessToken) {
      results.push({ user_email: row.user_email, code: access.error || 'no_access_token' })
      continue
    }
    const watch = await ensureGmailWatch({
      userEmail: row.user_email,
      crmEmail: row.crm_user_email,
      scope: row.scope,
      historyId: row.gmail_history_id,
      expiration: row.gmail_watch_expiration,
      accessToken: access.accessToken,
      force: false,
    })
    results.push({ user_email: row.user_email, code: watch.code })
  }
  return { code: 'ok', results }
}
