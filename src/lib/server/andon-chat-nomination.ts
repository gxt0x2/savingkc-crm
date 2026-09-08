import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  ANDON_TABLE,
  andonChatThreadKey,
  andonChatTitle,
  andonCrmUrl,
} from '@/lib/assistant/andon-write'

export type AndonChatNominationInput = {
  issueId: string
  issueKind: string
  department: string
  category: string
  priority: string
  raisedBy: string
  reporterEmail?: string | null
}

export type AndonChatNominationResult = {
  attempted: boolean
  posted: boolean
  reason: string
  chatSpaceId: string | null
  chatThreadId: string | null
}

function configuredSpace(): string | null {
  const value = process.env.CHAT_ANDON_SPACE?.trim()
  return value || null
}

function configuredWebhook(): string | null {
  const value = process.env.CHAT_ANDON_WEBHOOK_URL?.trim()
  return value || null
}

export function isGoogleChatWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'chat.googleapis.com'
  } catch {
    return false
  }
}

function nominationText(input: AndonChatNominationInput): string {
  const title = andonChatTitle(input.department, input.category, input.issueId)
  const reporter = input.reporterEmail ? `${input.raisedBy} (${input.reporterEmail})` : input.raisedBy
  return [
    `*${title}*`,
    `${input.department} / ${input.category} · ${input.priority} · ${input.issueKind}`,
    `Raised by ${reporter}`,
    `CRM Andon: ${andonCrmUrl(input.issueId)}`,
    `Issue id: ${input.issueId}`,
    'This thread is the war room. The Andon cord stays the CRM button.',
  ].join('\n')
}

async function persistChatIds(issueId: string, chatSpaceId: string | null, chatThreadId: string | null) {
  const update: Record<string, string> = {}
  if (chatSpaceId) update.chat_space_id = chatSpaceId
  if (chatThreadId) update.chat_thread_id = chatThreadId
  if (Object.keys(update).length === 0) return
  const { error } = await supabaseAdmin().from(ANDON_TABLE).update(update).eq('id', issueId)
  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'andon_chat_nomination_persist_failed',
      issueId,
      code: error.code ?? null,
    }))
  }
}

async function postIncomingWebhook(webhookUrl: string, input: AndonChatNominationInput) {
  const url = new URL(webhookUrl)
  if (!url.searchParams.has('messageReplyOption')) {
    url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD')
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      text: nominationText(input),
      thread: { threadKey: andonChatThreadKey(input.issueId) },
    }),
    signal: AbortSignal.timeout(8_000),
  })
  const payload = await response.json().catch(() => null) as {
    space?: { name?: string }
    thread?: { name?: string }
    error?: { message?: string }
  } | null
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Chat webhook returned ${response.status}`)
  }
  return {
    chatSpaceId: payload?.space?.name?.trim() || configuredSpace(),
    chatThreadId: payload?.thread?.name?.trim() || null,
  }
}

/**
 * Nominate a Google Chat war room after an Andon is pulled.
 *
 * This CRM has Gmail / Google Ads OAuth only — no Chat app service account.
 * TODO: set CHAT_ANDON_SPACE to the existing SavingKC Andon space (`spaces/...`).
 * Optional CHAT_ANDON_WEBHOOK_URL (chat.googleapis.com incoming webhook) posts
 * immediately. If either is missing, the Chat bot should poll list_open_andons.
 */
export async function nominateAndonGoogleChatThread(input: AndonChatNominationInput): Promise<AndonChatNominationResult> {
  try {
    const space = configuredSpace()
    const webhook = configuredWebhook()

    if (!space && !webhook) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'andon_chat_nomination_skipped',
        issueId: input.issueId,
        reason: 'CHAT_ANDON_SPACE_or_CHAT_ANDON_WEBHOOK_URL_missing',
        pollAction: 'list_open_andons',
        title: andonChatTitle(input.department, input.category, input.issueId),
      }))
      return { attempted: false, posted: false, reason: 'chat_credentials_missing', chatSpaceId: null, chatThreadId: null }
    }

    if (webhook && !isGoogleChatWebhookUrl(webhook)) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'andon_chat_nomination_skipped',
        issueId: input.issueId,
        reason: 'CHAT_ANDON_WEBHOOK_URL_not_chat_googleapis',
      }))
      await persistChatIds(input.issueId, space, null)
      return { attempted: false, posted: false, reason: 'invalid_chat_webhook', chatSpaceId: space, chatThreadId: null }
    }

    if (!webhook) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'andon_chat_nomination_space_only',
        issueId: input.issueId,
        reason: 'CHAT_ANDON_WEBHOOK_URL_missing',
        pollAction: 'list_open_andons',
        chatSpaceId: space,
        title: andonChatTitle(input.department, input.category, input.issueId),
      }))
      await persistChatIds(input.issueId, space, null)
      return { attempted: false, posted: false, reason: 'chat_webhook_missing', chatSpaceId: space, chatThreadId: null }
    }

    const posted = await postIncomingWebhook(webhook, input)
    await persistChatIds(input.issueId, posted.chatSpaceId, posted.chatThreadId)
    console.info(JSON.stringify({
      level: 'info',
      message: 'andon_chat_nomination_posted',
      issueId: input.issueId,
      chatSpaceId: posted.chatSpaceId,
      chatThreadId: posted.chatThreadId,
    }))
    return { attempted: true, posted: true, reason: 'posted', chatSpaceId: posted.chatSpaceId, chatThreadId: posted.chatThreadId }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'andon_chat_nomination_failed',
      issueId: input.issueId,
      error: error instanceof Error ? error.message : 'unknown',
    }))
    return {
      attempted: true,
      posted: false,
      reason: 'chat_post_failed',
      chatSpaceId: configuredSpace(),
      chatThreadId: null,
    }
  }
}
