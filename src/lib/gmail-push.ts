import { supabaseAdmin } from '@/lib/supabase/admin'
import { getValidAccessTokenResult, type StoredToken } from '@/lib/gmail-sync'
import { ingestGmailHistory } from '@/lib/gmail-history'
import {
  authorizeGmailPubSubRequest,
  decodeGmailPushMessage,
  isStaffOrSandboxMailbox,
  readGmailPubSubReadiness,
  type GmailPushNote,
} from '@/lib/gmail-pubsub'
import {
  historyIdAfterIngest,
  saveGmailHistoryCursor,
  type GmailWatchToken,
} from '@/lib/gmail-watch'

const RECEIPT_STALE_MS = 2 * 60 * 1000

type ClaimResult = 'claimed' | 'duplicate' | 'busy' | 'unavailable'

export type GmailPushDeps = {
  authorize?: typeof authorizeGmailPubSubRequest
  claim?: (note: GmailPushNote) => Promise<ClaimResult>
  complete?: (messageId: string) => Promise<void>
  release?: (messageId: string) => Promise<void>
  loadMailbox?: (email: string) => Promise<GmailWatchToken | null>
  ingest?: (
    mailbox: GmailWatchToken,
    notificationHistoryId: string,
  ) => Promise<{ scanned: number; matched: number; inserted: number; error?: string; skipped?: string }>
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' || /duplicate key/i.test(error?.message || '')
}

function receiptTableMissing(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42P01' || /gmail_push_receipts/i.test(error?.message || '')
}

async function claimReceipt(note: GmailPushNote): Promise<ClaimResult> {
  const db = supabaseAdmin()
  const inserted = await db.from('gmail_push_receipts').insert({
    message_id: note.messageId,
    mailbox: note.emailAddress,
    history_id: note.historyId,
    status: 'processing',
  }).select('message_id').maybeSingle()
  if (!inserted.error) return 'claimed'
  if (receiptTableMissing(inserted.error)) return 'unavailable'
  if (!isUniqueViolation(inserted.error)) return 'unavailable'

  const existing = await db
    .from('gmail_push_receipts')
    .select('status, received_at')
    .eq('message_id', note.messageId)
    .maybeSingle()
  if (existing.error || !existing.data) return 'duplicate'
  if (existing.data.status === 'processed') return 'duplicate'
  const receivedAt = Date.parse(existing.data.received_at || '')
  if (Number.isFinite(receivedAt) && Date.now() - receivedAt < RECEIPT_STALE_MS) return 'busy'

  const takeover = await db
    .from('gmail_push_receipts')
    .update({ status: 'processing', received_at: new Date().toISOString() })
    .eq('message_id', note.messageId)
    .eq('status', 'processing')
  if (takeover.error) return 'busy'
  return 'claimed'
}

async function completeReceipt(messageId: string): Promise<void> {
  await supabaseAdmin()
    .from('gmail_push_receipts')
    .update({ status: 'processed', processed_at: new Date().toISOString() })
    .eq('message_id', messageId)
}

async function releaseReceipt(messageId: string): Promise<void> {
  await supabaseAdmin().from('gmail_push_receipts').delete().eq('message_id', messageId)
}

async function loadMailbox(email: string): Promise<GmailWatchToken | null> {
  const { data, error } = await supabaseAdmin()
    .from('user_oauth_tokens')
    .select('*')
    .eq('user_email', email.trim().toLowerCase())
    .eq('provider', 'google')
    .maybeSingle()
  if (error || !data) return null
  return data as GmailWatchToken
}

async function ingestMailbox(
  mailbox: GmailWatchToken,
  notificationHistoryId: string,
): Promise<{ scanned: number; matched: number; inserted: number; error?: string; skipped?: string }> {
  const tokenResult = await getValidAccessTokenResult(mailbox as StoredToken)
  if (!tokenResult.accessToken) {
    return {
      scanned: 0,
      matched: 0,
      inserted: 0,
      skipped: tokenResult.error || 'token_refresh_failed',
    }
  }
  const result = await ingestGmailHistory({
    userEmail: mailbox.user_email,
    accessToken: tokenResult.accessToken,
    startHistoryId: mailbox.gmail_history_id || null,
    notificationHistoryId,
  })
  if (!result.error) {
    await saveGmailHistoryCursor(
      mailbox.user_email,
      historyIdAfterIngest(mailbox.gmail_history_id, result.historyId),
    )
    await supabaseAdmin()
      .from('user_oauth_tokens')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', mailbox.id)
  }
  return result
}

export async function handleGmailPubSubPush(input: {
  authorization: string | null
  queryToken: string | null
  headerToken: string | null
  body: unknown
  env?: Record<string, string | undefined>
  deps?: GmailPushDeps
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const readiness = readGmailPubSubReadiness(input.env)
  if (!readiness.ok) {
    return { status: 503, body: { error: 'pubsub_not_configured', missing: readiness.missing } }
  }

  const authorize = input.deps?.authorize || authorizeGmailPubSubRequest
  const auth = await authorize({
    authorization: input.authorization,
    queryToken: input.queryToken,
    headerToken: input.headerToken,
    env: input.env,
  })
  if (!auth.ok) return { status: auth.status, body: { error: auth.reason } }

  const note = decodeGmailPushMessage(input.body)
  if (!note) return { status: 400, body: { error: 'invalid_pubsub_message' } }
  if (note.subscription && note.subscription !== readiness.subscription) {
    return { status: 401, body: { error: 'pubsub_subscription_rejected' } }
  }

  const claim = input.deps?.claim || claimReceipt
  const claimed = await claim(note)
  if (claimed === 'unavailable') return { status: 503, body: { error: 'gmail_push_receipts_unavailable' } }
  if (claimed === 'duplicate') return { status: 200, body: { ok: true, duplicate: true } }
  if (claimed === 'busy') return { status: 503, body: { error: 'push_in_progress' } }

  const complete = input.deps?.complete || completeReceipt
  const release = input.deps?.release || releaseReceipt
  try {
    const load = input.deps?.loadMailbox || loadMailbox
    const mailbox = await load(note.emailAddress)
    const eligible = Boolean(mailbox) && isStaffOrSandboxMailbox({
      googleEmail: note.emailAddress,
      crmEmail: mailbox?.crm_user_email,
      extraAllowlist: readiness.allowlist,
    })
    if (!mailbox || !eligible) {
      await complete(note.messageId)
      return { status: 200, body: { ok: true, skipped: mailbox ? 'ineligible_mailbox' : 'no_token' } }
    }

    const ingest = input.deps?.ingest || ingestMailbox
    const result = await ingest(mailbox, note.historyId)
    if (result.skipped) {
      await complete(note.messageId)
      return { status: 200, body: { ok: true, skipped: result.skipped } }
    }
    if (result.error) {
      await release(note.messageId)
      return { status: 502, body: { error: result.error } }
    }
    await complete(note.messageId)
    return {
      status: 200,
      body: {
        ok: true,
        scanned: result.scanned,
        matched: result.matched,
        inserted: result.inserted,
      },
    }
  } catch {
    await release(note.messageId).catch(() => undefined)
    return { status: 500, body: { error: 'gmail_push_failed' } }
  }
}
